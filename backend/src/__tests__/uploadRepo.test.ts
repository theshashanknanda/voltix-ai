import request from 'supertest';
import express from 'express';

const mockPrismaCreate = jest.fn().mockResolvedValue({ id: 'repo-upload-id' });

jest.mock('../middleware/requireAuth', () => ({
  __esModule: true,
  default: (req: any, _res: any, next: any) => {
    req.user = { id: 'test-user', email: 'test@example.com' };
    next();
  },
}));

jest.mock('../database/prismaClient', () => ({
  __esModule: true,
  prisma: {
    analysis: {
      create: mockPrismaCreate,
    },
  },
}));

import uploadRepoRouter from '../api/uploadRepo';

describe('POST /api/upload-repo', () => {
  const app = express();
  app.use(express.json());
  app.use('/api', uploadRepoRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = jest.fn();
  });

  it('should parse a GitHub repo URL, fetch supported files, and persist an Analysis record', async () => {
    const metadata = { default_branch: 'main' };
    const tree = {
      tree: [
        { path: 'src/index.ts', type: 'blob' },
        { path: 'README.md', type: 'blob' },
        { path: 'image.png', type: 'blob' },
      ],
    };

    const fetchMock = (global as any).fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => metadata })
      .mockResolvedValueOnce({ ok: true, json: async () => tree })
      .mockResolvedValueOnce({ ok: true, headers: { get: () => 'text/plain' }, text: async () => 'const a = 1;' })
      .mockResolvedValueOnce({ ok: true, headers: { get: () => 'text/plain' }, text: async () => '# Hello World' })
      .mockResolvedValueOnce({ ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from('PNGDATA') });

    const response = await request(app)
      .post('/api/upload-repo')
      .send({ url: 'https://github.com/test-owner/test-repo' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('analysisId', 'repo-upload-id');
    expect(response.body.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'README.md', name: 'README.md', content: '# Hello World', language: 'markdown' }),
        expect.objectContaining({ path: 'src/index.ts', name: 'index.ts', content: 'const a = 1;', language: 'typescript' }),
      ]),
    );
    expect(response.body.files).toHaveLength(3);
    expect(mockPrismaCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ repositoryUrl: 'https://github.com/test-owner/test-repo' }),
    }));
  });

  it('should return 400 for invalid GitHub URLs', async () => {
    const response = await request(app)
      .post('/api/upload-repo')
      .send({ url: 'not-a-valid-url' });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });
});
