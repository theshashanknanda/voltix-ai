import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { strToU8, zipSync } from 'fflate';

jest.mock('../database/prismaClient', () => ({ __esModule: true, prisma: {} }));

import uploadZipRouter from '../api/uploadZip';

const app = express();
app.use('/api', uploadZipRouter);

const authHeader = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  const token = jwt.sign({ sub: 'test-user', email: 'test@example.com' }, secret);
  return { Authorization: `Bearer ${token}` };
};

const zip = (files: Record<string, string | Uint8Array>) => Buffer.from(zipSync(
  Object.fromEntries(Object.entries(files).map(([name, body]) => [name, typeof body === 'string' ? strToU8(body) : body])),
));

const upload = (body: Buffer, filename = 'project.zip') =>
  request(app).post('/api/upload-zip').set(authHeader()).attach('file', body, filename);

describe('POST /api/upload-zip', () => {
  it('returns both source files in the GitHub import shape, without the shared top folder', async () => {
    const response = await upload(zip({
      'project-main/src/index.ts': 'const a = 1;',
      'project-main/app.py': 'print("hi")',
    }));

    expect(response.status).toBe(200);
    expect(response.body.files).toEqual([
      { path: 'app.py', name: 'app.py', content: 'print("hi")', language: 'python' },
      { path: 'src/index.ts', name: 'index.ts', content: 'const a = 1;', language: 'typescript' },
    ]);
    expect(response.body.meta).toEqual({
      name: 'project.zip', totalFiles: 2, returnedFiles: 2, truncated: false, skippedSecrets: 0, skippedLarge: 0,
    });
  });

  it('skips and counts secret files', async () => {
    const response = await upload(zip({ '.env': 'API_KEY=abcdefgh123', 'keys/id_rsa': 'key', 'a.js': 'x()' }));

    expect(response.status).toBe(200);
    expect(response.body.files.map((f: { path: string }) => f.path)).toEqual(['a.js']);
    expect(response.body.meta.skippedSecrets).toBe(2);
    expect(response.body.meta.warning).toBe('Skipped 2 secret file(s) (.env or private keys).');
  });

  it('returns 400 for a non-zip body, an empty upload, and no file', async () => {
    const notZip = await upload(Buffer.from('just some text'), 'notes.zip');
    const empty = await upload(Buffer.alloc(0));
    const missing = await request(app).post('/api/upload-zip').set(authHeader());

    expect(notZip.status).toBe(400);
    expect(notZip.body.error).toBe('Uploaded file is not a valid ZIP archive.');
    expect(empty.status).toBe(400);
    expect(missing.status).toBe(400);
  });

  it('returns 400 when no supported text file remains', async () => {
    const response = await upload(zip({ 'tool.exe': 'MZ', 'bin.js': new Uint8Array([0x63, 0, 0x64]) }));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('The ZIP contains no supported text files.');
  });

  it.each([undefined, 'not-a-jwt', jwt.sign({ sub: 'test-user' }, 'wrong-secret')])(
    'returns 401 without a valid JWT (%p)', async (token) => {
      const req = request(app).post('/api/upload-zip');
      if (token) req.set('Authorization', `Bearer ${token}`);
      const response = await req.attach('file', zip({ 'a.js': 'x()' }), 'project.zip');
      expect(response.status).toBe(401);
    },
  );

  it('returns only the first 100 supported files and flags truncation', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 101 }, (_, i) => [`src/f${String(i).padStart(3, '0')}.js`, `// ${i}`]),
    );
    const response = await upload(zip(files));

    expect(response.status).toBe(200);
    expect(response.body.files).toHaveLength(100);
    expect(response.body.files.at(-1).path).toBe('f099.js');
    expect(response.body.meta).toEqual(expect.objectContaining({ totalFiles: 101, returnedFiles: 100, truncated: true }));
    expect(response.body.meta.warning).toBe('Archive contains 101 supported files. Only the first 100 files were imported.');
  });

  it('skips entries larger than 1 MB and imports the rest', async () => {
    const response = await upload(zip({ 'big.js': 'a'.repeat(1024 * 1024 + 1), 'small.js': 'ok()' }));

    expect(response.status).toBe(200);
    expect(response.body.files.map((f: { path: string }) => f.path)).toEqual(['small.js']);
    expect(response.body.meta.skippedLarge).toBe(1);
    expect(response.body.meta.warning).toBe('Skipped 1 file(s) larger than 1 MB.');
  });

  it('rejects an archive with an entry that escapes it', async () => {
    const response = await upload(zip({ 'a.js': 'x()', '../evil.js': 'boom()' }));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ZIP entry "../evil.js" points outside the archive.');
  });
});
