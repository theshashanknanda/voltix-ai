import { authHeader } from '../testSupport/auth0';
import request from 'supertest';
import express from 'express';

const mockCreate = jest.fn();
const mockFind = jest.fn();
const mockProjectUpdate = jest.fn(async ({ data }) => data);
const mockFileUpdate = jest.fn(async ({ data }) => data);
let mockUser: Record<string, unknown>;
const mockTx = {
  $queryRaw: jest.fn(),
  user: {
    findUnique: jest.fn(async () => mockUser),
    update: jest.fn(async ({ data }) => Object.assign(mockUser, data)),
  },
};

jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: { completions: { create: mockCreate } },
})));
jest.mock('../database/prismaClient', () => ({
  prisma: {
    project: { findFirst: mockFind, update: mockProjectUpdate },
    projectFile: { update: mockFileUpdate },
    $transaction: (work: (tx: unknown) => Promise<unknown>) => work(mockTx),
  },
}));

import chatRouter from '../api/chat';
import projectRouter from '../api/projects';
import { usageMonth } from '../billing/quotas';
import { SECRET_MESSAGE } from '../secrets';
import { EDITS_ONLY_MESSAGE } from '../api/explainCode';

const app = express();
app.use(express.json());
app.use('/api', chatRouter);
app.use('/api', projectRouter);

const file = (path: string, content: string) => ({ path, name: path, content, language: 'javascript' });
const reply = (content: string) => mockCreate.mockResolvedValue({ choices: [{ message: { content } }] });
const promptText = () => JSON.stringify(mockCreate.mock.calls[0][0].messages);

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'test-user', plan: 'FREE', usageMonth: usageMonth(), chatMessagesUsed: 0 };
});

const send = (body: object) => request(app).post('/api/chat').set(authHeader()).send(body);

describe('POST /api/chat', () => {
  const project = {
    id: 'project-1',
    files: [file('src/a.js', 'export const a = 1;\n'), file('src/b.js', 'export function add(x) { return x; }\n')],
    chat: [],
  };

  it('names both saved files and does not write file contents', async () => {
    mockFind.mockResolvedValue(project);
    reply('`add` in src/b.js returns its argument.');

    const response = await send({
      projectId: 'project-1',
      message: 'What does add do?',
      openPath: 'src/a.js',
      neighborPaths: ['src/b.js'],
    });

    expect(response.status).toBe(200);
    expect(response.body.paths).toEqual(['src/a.js', 'src/b.js']);
    expect(response.body.answer).toContain('src/a.js');
    expect(response.body.answer).toContain('src/b.js');
    expect(promptText()).toContain('export function add');
    expect(mockProjectUpdate).toHaveBeenCalledTimes(1);
    expect(mockProjectUpdate.mock.calls[0][0].data.files).toBeUndefined();
    expect(mockProjectUpdate.mock.calls[0][0].data.chat).toHaveLength(2);
  });

  it('lists a fourth file as left out and stops the left-out list at 50', async () => {
    const neighbors = ['n1.js', 'n2.js', 'n3.js', 'n4.js'].map(path => file(path, `export const ${path} = 1;\n`));
    mockFind.mockResolvedValue({ id: 'project-1', files: [file('src/a.js', 'import "./n1.js";\n'), ...neighbors], chat: [] });
    reply('Uses the first neighbors.');
    const omittedPaths = Array.from({ length: 51 }, (_, index) => `extra/${index}.js`);

    const response = await send({
      projectId: 'project-1',
      message: 'How is this wired?',
      openPath: 'src/a.js',
      neighborPaths: neighbors.map(item => item.path),
      omittedPaths,
    });

    expect(response.status).toBe(200);
    expect(response.body.paths).toEqual(['src/a.js', 'n1.js', 'n2.js', 'n3.js']);
    expect(response.body.answer).toContain('Left out (limit 3): n4.js');
    expect(response.body.omitted).toHaveLength(50);
    expect(response.body.omitted).toContain('extra/48.js');
    expect(response.body.omitted).not.toContain('extra/49.js');
    expect(promptText()).toContain('Open file: src/a.js');
    expect(promptText()).not.toContain('export const n4.js');
  });

  it('sends earlier messages on a follow-up and keeps the last 20', async () => {
    const older = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message ${index}`,
    }));
    mockFind.mockResolvedValue({ ...project, chat: older });
    reply('It returns x.');

    const response = await send({ projectId: 'project-1', message: 'What does it return?', openPath: 'src/b.js' });

    expect(response.status).toBe(200);
    expect(promptText()).toContain('message 19');
    expect(promptText()).toContain('message 0');
    const stored = mockProjectUpdate.mock.calls[0][0].data.chat;
    expect(stored).toHaveLength(20);
    expect(stored[0].content).toBe('message 2');
    expect(stored.some((message: { content: string }) => message.content === 'message 0')).toBe(false);
    expect(stored.at(-2).content).toBe('What does it return?');
    expect(response.body.messages).toHaveLength(20);
  });

  it('returns 400 when a neighbor holds a secret and does not call the model', async () => {
    mockFind.mockResolvedValue({
      id: 'project-1',
      files: [file('src/a.js', 'export const a = 1;\n'), file('src/b.js', 'const password = "hunter2xyz";\n')],
      chat: [],
    });

    const response = await send({
      projectId: 'project-1',
      message: 'What is in the neighbor?',
      openPath: 'src/a.js',
      neighborPaths: ['src/b.js'],
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: SECRET_MESSAGE });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockProjectUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty question without calling the model', async () => {
    const response = await send({ projectId: 'project-1', message: '   ' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Question is empty.');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockFind).not.toHaveBeenCalled();
  });

  it('returns 401 without a session', async () => {
    const response = await request(app).post('/api/chat').send({ projectId: 'project-1', message: 'Hi' });
    expect(response.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockFind).not.toHaveBeenCalled();
  });
});

describe('file edit suggestions', () => {
  const appFile = { ...file('src/app.js', 'function add() {}\n'), id: 'file-app' };
  const otherFile = { ...file('src/other.js', 'function keep() {}\n'), id: 'file-other' };

  it('returns replacement text for src/app.js and does not write until apply', async () => {
    mockFind.mockResolvedValue({ id: 'project-1', files: [appFile, otherFile], chat: [] });
    reply(JSON.stringify({ answer: 'Renamed add to sum.', edit: { path: 'src/app.js', content: 'function sum() {}\n' } }));

    const response = await send({ projectId: 'project-1', message: 'Rename add to sum.', openPath: 'src/app.js' });

    expect(response.status).toBe(200);
    expect(response.body.suggestion).toEqual({ path: 'src/app.js', content: 'function sum() {}\n', status: 'pending' });
    expect(response.body.answer).toContain('Renamed add to sum.');
    expect(mockProjectUpdate).toHaveBeenCalledTimes(1);
    expect(mockProjectUpdate.mock.calls[0][0].data.files).toBeUndefined();
    expect(mockFileUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty edit or a path outside the project and writes nothing', async () => {
    mockFind.mockResolvedValue({ id: 'project-1', files: [appFile], chat: [] });
    reply(JSON.stringify({ answer: 'Empty.', edit: { path: 'src/app.js', content: '  ' } }));
    const empty = await send({ projectId: 'project-1', message: 'Rename add.', openPath: 'src/app.js' });

    reply(JSON.stringify({ answer: 'Outside.', edit: { path: '../outside.js', content: 'function sum() {}\n' } }));
    const outside = await send({ projectId: 'project-1', message: 'Rename add.', openPath: 'src/app.js' });

    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('The suggested edit is empty.');
    expect(outside.status).toBe(400);
    expect(outside.body.error).toBe('That file is not in this project.');
    expect(mockProjectUpdate).not.toHaveBeenCalled();
    expect(mockFileUpdate).not.toHaveBeenCalled();
  });

  it('explains that edits are only available for the seven supported languages', async () => {
    mockFind.mockResolvedValue({
      id: 'project-1',
      files: [{ path: 'README.md', name: 'README.md', content: '# Title\n', language: 'markdown' }],
      chat: [],
    });

    const response = await send({ projectId: 'project-1', message: 'Rename the heading.', openPath: 'README.md' });

    expect(response.status).toBe(200);
    expect(response.body.answer).toContain(EDITS_ONLY_MESSAGE);
    expect(response.body.suggestion).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockFileUpdate).not.toHaveBeenCalled();
    expect(mockProjectUpdate.mock.calls[0][0].data.files).toBeUndefined();
  });

  it('apply updates that file only, and a secret or outside path writes nothing', async () => {
    mockFind.mockResolvedValue({
      id: 'project-1',
      files: [appFile, otherFile],
      chat: [{ role: 'assistant', content: 'Renamed.', suggestion: { path: 'src/app.js', content: 'function sum() {}\n', status: 'pending' } }],
    });
    const applied = await request(app).post('/api/projects/project-1/files').set(authHeader())
      .send({ path: 'src/app.js', content: 'function sum() {}\n' });

    expect(applied.status).toBe(200);
    expect(applied.body.message).toBe('Edit applied to src/app.js.');
    expect(mockFileUpdate).toHaveBeenCalledTimes(1);
    expect(mockFileUpdate).toHaveBeenCalledWith({ where: { id: 'file-app' }, data: { content: 'function sum() {}\n' } });
    expect(mockProjectUpdate.mock.calls[0][0].data.files).toBeUndefined();
    expect(mockProjectUpdate.mock.calls[0][0].data.chat[0].suggestion.status).toBe('applied');

    mockProjectUpdate.mockClear();
    mockFileUpdate.mockClear();
    const secret = await request(app).post('/api/projects/project-1/files').set(authHeader())
      .send({ path: 'src/app.js', content: 'const password = "hunter2xyz";\n' });
    const missing = await request(app).post('/api/projects/project-1/files').set(authHeader())
      .send({ path: 'nope.js', content: 'function sum() {}\n' });
    const anonymous = await request(app).post('/api/projects/project-1/files')
      .send({ path: 'src/app.js', content: 'function sum() {}\n' });

    expect(secret.status).toBe(400);
    expect(secret.body).toEqual({ error: SECRET_MESSAGE });
    expect(missing.status).toBe(400);
    expect(anonymous.status).toBe(401);
    expect(mockProjectUpdate).not.toHaveBeenCalled();
    expect(mockFileUpdate).not.toHaveBeenCalled();
  });

  it('dismiss marks the suggestion and does not write the file', async () => {
    mockFind.mockResolvedValue({
      id: 'project-1',
      files: [appFile],
      chat: [{ role: 'assistant', content: 'Renamed.', suggestion: { path: 'src/app.js', content: 'function sum() {}\n', status: 'pending' } }],
    });

    const response = await request(app).post('/api/projects/project-1/files/dismiss').set(authHeader())
      .send({ path: 'src/app.js' });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Suggestion dismissed.');
    expect(mockProjectUpdate.mock.calls[0][0].data.files).toBeUndefined();
    expect(mockProjectUpdate.mock.calls[0][0].data.chat[0].suggestion.status).toBe('dismissed');
    expect(mockFileUpdate).not.toHaveBeenCalled();
  });
});
