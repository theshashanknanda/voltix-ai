import { authHeader } from '../testSupport/auth0';
import express from 'express';
import request from 'supertest';

let mockUser: Record<string, unknown>;
let mockCount = 0;
const mockUpdate = jest.fn(async ({ data }) => Object.assign(mockUser, data));
const mockCreate = jest.fn(async () => { mockCount++; return { id: 'project' }; });
const mockTx = {
  $queryRaw: jest.fn(),
  user: { findUnique: jest.fn(async () => mockUser), update: mockUpdate },
  project: { count: jest.fn(async () => mockCount), create: mockCreate },
  analysis: { create: jest.fn(async () => ({ id: 'analysis' })) },
};
// A serialized transaction test double models the per-user database lock. The
// production implementation uses PostgreSQL FOR UPDATE, not an in-process lock.
let mockTail = Promise.resolve();
jest.mock('../database/prismaClient', () => ({ prisma: {
  $transaction: (work: (tx: unknown) => Promise<unknown>) => {
    const result = mockTail.then(() => work(mockTx));
    mockTail = result.then(() => undefined, () => undefined);
    return result;
  },
} }));
import requireAuth from '../middleware/requireAuth';
import chatQuota from '../middleware/chatQuota';
import { consumeChatMessage, getBillingUsage, usageMonth } from '../billing/quotas';
import { saveImportedProject } from '../projects/importedProjects';

const model = jest.fn((_req, res) => res.json({ answer: 'model answer' }));
const app = express();
app.post('/api/chat', requireAuth, chatQuota, model);
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'test-user', plan: 'FREE', usageMonth: usageMonth(), chatMessagesUsed: 0 };
  mockCount = 0;
});
it('rejects the 21st Free message with 402 without calling the model', async () => {
  mockUser.chatMessagesUsed = 19;
  expect((await request(app).post('/api/chat').set(authHeader())).status).toBe(200);
  expect((await request(app).post('/api/chat').set(authHeader())).status).toBe(402);
  expect(mockUser.chatMessagesUsed).toBe(20);
  expect(model).toHaveBeenCalledTimes(1);
});
it('requires a session before consuming a message', async () => {
  expect((await request(app).post('/api/chat')).status).toBe(401);
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(model).not.toHaveBeenCalled();
});
it('allows Pro message 500 and rejects 501', async () => {
  Object.assign(mockUser, { plan: 'PRO', chatMessagesUsed: 499 });
  await consumeChatMessage('test-user');
  await expect(consumeChatMessage('test-user')).rejects.toMatchObject({ status: 402 });
});
it('resets a previous calendar month without a scheduler', async () => {
  Object.assign(mockUser, { usageMonth: '2000-01', chatMessagesUsed: 500 });
  expect(await consumeChatMessage('test-user')).toMatchObject({ used: 1, remaining: 19, month: usageMonth() });
});
it('admits only one of two simultaneous requests at the last message', async () => {
  mockUser.chatMessagesUsed = 19;
  const results = await Promise.allSettled([consumeChatMessage('test-user'), consumeChatMessage('test-user')]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(mockUser.chatMessagesUsed).toBe(20);
  expect(mockTx.$queryRaw).toHaveBeenCalledTimes(2);
});
it('does not count saved analyses or browsing as projects/messages', async () => {
  const usage = await getBillingUsage('test-user');
  expect(usage.usage).toEqual({ chatMessages: 0, savedProjects: 0 });
  expect(mockUpdate).not.toHaveBeenCalled();
});
const snapshot = { source: 'zip' as const, label: 'project.zip', files: [{ path: 'a.js', name: 'a.js', content: 'run()', language: 'javascript' }], metadata: {} };
it('saves a real snapshot, then rejects a second Free project before writing', async () => {
  expect(await saveImportedProject('test-user', snapshot)).toMatchObject({ projectId: 'project' });
  await expect(saveImportedProject('test-user', snapshot)).rejects.toMatchObject({ status: 402 });
  expect(mockCreate).toHaveBeenCalledTimes(1);
});
it('rechecks project capacity when simultaneous imports finish', async () => {
  const results = await Promise.allSettled([saveImportedProject('test-user', snapshot), saveImportedProject('test-user', snapshot)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(mockCount).toBe(1);
});
it('allows 20 Pro projects and preserves existing projects on downgrade', async () => {
  mockUser.plan = 'PRO'; mockCount = 19;
  await saveImportedProject('test-user', snapshot);
  await expect(saveImportedProject('test-user', snapshot)).rejects.toMatchObject({ status: 402 });
  mockUser.plan = 'FREE';
  const usage = await getBillingUsage('test-user');
  expect(usage.usage.savedProjects).toBe(20);
  expect(usage.remaining.savedProjects).toBe(0);
});
