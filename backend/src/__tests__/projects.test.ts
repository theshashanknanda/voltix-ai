import { authHeader } from '../testSupport/auth0';
import request from 'supertest';
import express from 'express';
const mockFind = jest.fn();
const mockList = jest.fn();
const mockDelete = jest.fn();
jest.mock('../database/prismaClient', () => ({ prisma: { project: { findFirst: mockFind, findMany: mockList, deleteMany: mockDelete } } }));
import projectRouter from '../api/projects';
const app = express(); app.use('/api', projectRouter);
beforeEach(() => { jest.clearAllMocks(); });
it('lists only the current user projects without downloading snapshots', async () => {
  mockList.mockResolvedValue([]);
  expect((await request(app).get('/api/projects').set(authHeader())).status).toBe(200);
  expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'test-user' }, select: expect.not.objectContaining({ files: true }) }));
});
it('reopens an owned snapshot without model work or quota consumption', async () => {
  mockFind.mockResolvedValue({ id: 'mine', files: [{ path: 'a.js', content: 'run()' }] });
  const response = await request(app).get('/api/projects/mine').set(authHeader());
  expect(response.status).toBe(200); expect(response.body.project.files).toHaveLength(1);
  expect(mockFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'mine', userId: 'test-user' } }));
});
it('does not disclose or delete a project owned by someone else', async () => {
  mockFind.mockResolvedValue(null); mockDelete.mockResolvedValue({ count: 0 });
  expect((await request(app).get('/api/projects/other').set(authHeader())).status).toBe(404);
  expect((await request(app).delete('/api/projects/other').set(authHeader())).status).toBe(404);
  expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'other', userId: 'test-user' } });
});
it('deletes an owned project, freeing its slot', async () => {
  mockDelete.mockResolvedValue({ count: 1 });
  expect((await request(app).delete('/api/projects/mine').set(authHeader())).status).toBe(200);
});
it('requires a session to list projects', async () => {
  expect((await request(app).get('/api/projects')).status).toBe(401); expect(mockList).not.toHaveBeenCalled();
});
