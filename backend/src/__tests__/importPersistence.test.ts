import request from 'supertest';
import express from 'express';
import { strToU8, zipSync } from 'fflate';

// In-memory rows so the import routes and the read routes share real state.
type Row = Record<string, any>;
const mockDb = { projects: [] as Row[], analyses: [] as Row[] };
const mockTx = {
  $queryRaw: jest.fn(),
  user: { findUnique: async ({ where }: Row) => ({ id: where.id, plan: 'PRO' }) },
  project: {
    count: async ({ where }: Row) => mockDb.projects.filter((p) => p.userId === where.userId).length,
    create: async ({ data }: Row) => {
      const project = { ...data, id: `project-${mockDb.projects.length}`, files: data.files.create };
      mockDb.projects.push(project);
      return project;
    },
    findFirst: async ({ where }: Row) => mockDb.projects.find((p) => p.id === where.id && p.userId === where.userId) ?? null,
  },
  analysis: {
    create: async ({ data }: Row) => {
      const analysis = { ...data, id: `analysis-${mockDb.analyses.length}` };
      mockDb.analyses.push(analysis);
      return analysis;
    },
    findFirst: async ({ where }: Row) => {
      const analysis = mockDb.analyses.find((a) => a.id === where.id && a.userId === where.userId);
      return analysis && { project: mockDb.projects.find((p) => p.id === analysis.projectId) ?? null };
    },
  },
};
jest.mock('../database/prismaClient', () => ({ prisma: { ...mockTx, $transaction: (work: (tx: unknown) => unknown) => work(mockTx) } }));
jest.mock('../middleware/requireAuth', () => ({
  __esModule: true,
  default: (req: any, res: any, next: any) => {
    const id = req.headers['x-test-user'];
    if (!id) { res.status(401).json({ error: 'Unauthorized.' }); return; }
    req.user = { id, email: `${id}@example.com` };
    next();
  },
}));

import uploadRepoRouter from '../api/uploadRepo';
import uploadZipRouter from '../api/uploadZip';
import projectsRouter from '../api/projects';
import analysesRouter from '../api/analyses';

const app = express();
app.use(express.json());
app.use('/api', uploadRepoRouter, uploadZipRouter, projectsRouter, analysesRouter);

const as = (user: string) => ({ 'x-test-user': user });

beforeEach(() => {
  mockDb.projects.length = 0;
  mockDb.analyses.length = 0;
  (global as any).fetch = jest.fn(async (url: string) => {
    if (url.endsWith('/repos/owner/repo')) return { ok: true, json: async () => ({ default_branch: 'main' }) };
    if (url.includes('/git/trees/')) {
      const tree = Array.from({ length: 101 }, (_, i) => ({ path: `src/f${String(i).padStart(3, '0')}.js`, type: 'blob' }));
      return { ok: true, json: async () => ({ tree: [{ path: '.env', type: 'blob' }, ...tree] }) };
    }
    return { ok: true, headers: { get: () => 'text/plain' }, text: async () => `// ${url.split('/').pop()}` };
  });
});

it('saves a GitHub import for the signed-in user and serves it back without GitHub', async () => {
  const imported = await request(app).post('/api/upload-repo').set(as('alice')).send({ url: 'https://github.com/owner/repo' });
  expect(imported.status).toBe(200);

  const [project] = mockDb.projects;
  expect(project.userId).toBe('alice');
  expect(project.files).toHaveLength(100);
  expect(project.files.map((f: Row) => f.path)).not.toContain('.env');
  expect(project.files[0]).toEqual({ path: 'src/f000.js', name: 'f000.js', content: '// f000.js', language: 'javascript' });
  expect(project.metadata).toEqual(expect.objectContaining({
    truncated: true, warning: expect.stringContaining('Only the first 100 files were imported.'),
  }));

  (global.fetch as jest.Mock).mockClear();
  const reopened = await request(app).get(`/api/projects/${imported.body.projectId}`).set(as('alice'));
  expect(reopened.body.project.files).toEqual(imported.body.files);
  const viewSaved = await request(app).get(`/api/analyses/${imported.body.analysisId}/files`).set(as('alice'));
  expect(viewSaved.body.files).toEqual(imported.body.files);
  expect(global.fetch).not.toHaveBeenCalled();

  expect((await request(app).get(`/api/projects/${imported.body.projectId}`).set(as('bob'))).status).toBe(404);
  expect((await request(app).get(`/api/analyses/${imported.body.analysisId}/files`).set(as('bob'))).status).toBe(404);
});

it('saves a ZIP import for the signed-in user, without secrets, hidden from other users', async () => {
  const zip = Buffer.from(zipSync({ 'a.js': strToU8('run()'), '.env': strToU8('API_KEY=abcdefgh123') }));
  const imported = await request(app).post('/api/upload-zip').set(as('alice')).attach('file', zip, 'project.zip');
  expect(imported.status).toBe(200);

  expect(mockDb.projects).toHaveLength(1);
  expect(mockDb.projects[0]).toEqual(expect.objectContaining({
    userId: 'alice', source: 'zip', files: [{ path: 'a.js', name: 'a.js', content: 'run()', language: 'javascript' }],
  }));

  const reopened = await request(app).get(`/api/projects/${imported.body.projectId}`).set(as('alice'));
  expect(reopened.body.project.files).toEqual(imported.body.files);
  expect((await request(app).get(`/api/projects/${imported.body.projectId}`).set(as('bob'))).status).toBe(404);
});

it('saves nothing when the import is not signed in', async () => {
  expect((await request(app).post('/api/upload-repo').send({ url: 'https://github.com/owner/repo' })).status).toBe(401);
  expect(mockDb.projects).toHaveLength(0);
});

it('refuses to link a saved explanation to another user project', async () => {
  const imported = await request(app).post('/api/upload-repo').set(as('alice')).send({ url: 'https://github.com/owner/repo' });
  const linked = await request(app).post('/api/analyses').set(as('bob'))
    .send({ repositoryUrl: 'x', explanation: 'y', projectId: imported.body.projectId });
  expect(linked.status).toBe(404);
  expect(mockDb.analyses.filter((a) => a.userId === 'bob')).toHaveLength(0);
});
