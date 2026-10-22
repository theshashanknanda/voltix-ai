import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

const mockCreate = jest.fn();

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }));
});

import explainRouter from '../api/explainCode';
import { SECRET_MESSAGE } from '../secrets';

const app = express();
app.use(express.json());
app.use('/api', explainRouter);

const authHeader = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  const token = jwt.sign({ sub: 'test-user', email: 'test@example.com' }, secret);
  return { Authorization: `Bearer ${token}` };
};

const reply = (content: string | null) => mockCreate.mockResolvedValue({ choices: [{ message: { content } }] });
const promptText = (): string => mockCreate.mock.calls[0][0].messages[0].content;

const JS_SOURCE = 'function add(a, b) {\n  return a + b;\n}\n';
const JS_COMMENTED = '// Small math helpers.\n\n// Returns the sum of a and b.\nfunction add(a, b) {\n  return a + b;\n}\n';
const PROVIDER_DUMP = 'SECRET_PROVIDER_DUMP_groq-timeout-xyz';

describe('POST /api/document', () => {
  beforeEach(() => jest.resetAllMocks());

  it('returns the original JS with a file comment and a comment above the function', async () => {
    reply('```javascript\n' + JS_COMMENTED + '```');

    const response = await request(app).post('/api/document').set(authHeader())
      .send({ code: JS_SOURCE, filename: 'add.js', language: 'javascript' });

    expect(response.status).toBe(200);
    expect(response.body.code).toContain(JS_SOURCE.trim());
    const lines: string[] = response.body.code.split('\n');
    expect(lines[0]).toMatch(/^\/\/\s*\S/);
    expect(lines[lines.indexOf('function add(a, b) {') - 1]).toMatch(/^\/\/\s*\S/);
  });

  it('accepts a Python docstring and asks for docstrings', async () => {
    const source = 'def greet(name):\n    return f"hi {name}"\n';
    const commented = '"""Greeting helpers."""\n\ndef greet(name):\n    """Return a greeting for name."""\n    return f"hi {name}"\n';
    reply(commented);

    const response = await request(app).post('/api/document').set(authHeader())
      .attach('file', Buffer.from(source), 'greet.py');

    expect(response.status).toBe(200);
    expect(response.body.code).toBe(commented);
    expect(promptText()).toContain('docstring');
  });

  it('returns 400 for blank code without calling Groq', async () => {
    const response = await request(app).post('/api/document').set(authHeader())
      .send({ code: '   ', filename: 'a.js' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Code content is empty.');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 401 without a JWT', async () => {
    const response = await request(app).post('/api/document').send({ code: JS_SOURCE });
    expect(response.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['the provider throws', () => mockCreate.mockRejectedValue(new Error(PROVIDER_DUMP))],
    ['the reply is empty', () => reply('')],
    ['the reply drops the original function', () => reply(`// ${PROVIDER_DUMP}\n// Adds numbers.\nconst add = (a, b) => a + b;\n`)],
    ['the reply adds nothing', () => reply(JS_SOURCE)],
  ])('returns a safe 500 when %s', async (_label, arrange) => {
    arrange();
    const response = await request(app).post('/api/document').set(authHeader())
      .send({ code: JS_SOURCE, filename: 'add.js', language: 'javascript' });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'AI error: Documentation generation failed.' });
  });
});

describe('POST /api/explain-function', () => {
  beforeEach(() => jest.resetAllMocks());

  const body = { code: JS_SOURCE + '\nfunction sub(a, b) {\n  return a - b;\n}\n', filename: 'math.js', functionName: 'add' };

  it('explains the named function and keeps the prompt on it', async () => {
    reply('### `add`\n\nReturns the sum of `a` and `b`.');

    const response = await request(app).post('/api/explain-function').set(authHeader()).send(body);

    expect(response.status).toBe(200);
    expect(response.body.explanation).toContain('add');
    expect(promptText()).toContain('Explain only the function `add`');
    expect(promptText()).toContain('function sub');
  });

  it('adds the function name when the reply omits it', async () => {
    reply('Returns the sum of its two arguments.');
    const response = await request(app).post('/api/explain-function').set(authHeader()).send(body);
    expect(response.status).toBe(200);
    expect(response.body.explanation).toMatch(/^### `add`/);
  });

  it.each([undefined, '', '   ', 42])('returns 400 for functionName %p', async (functionName) => {
    const response = await request(app).post('/api/explain-function').set(authHeader())
      .send({ ...body, functionName });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Please choose a function to explain.');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 for blank code or an unknown function', async () => {
    const blank = await request(app).post('/api/explain-function').set(authHeader()).send({ ...body, code: ' ' });
    const unknown = await request(app).post('/api/explain-function').set(authHeader()).send({ ...body, functionName: 'mul' });
    expect(blank.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toContain('"mul" was not found');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 401 without a JWT', async () => {
    const response = await request(app).post('/api/explain-function').send(body);
    expect(response.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 for a file with a credential literal without calling Groq', async () => {
    const response = await request(app).post('/api/explain-function').set(authHeader())
      .send({ ...body, code: `const password = "hunter2xyz";\n${body.code}` });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: SECRET_MESSAGE });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['the provider throws', () => mockCreate.mockRejectedValue(new Error(PROVIDER_DUMP))],
    ['the reply is empty', () => reply(null)],
  ])('returns a safe 500 when %s', async (_label, arrange) => {
    arrange();
    const response = await request(app).post('/api/explain-function').set(authHeader()).send(body);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'AI error: Function explanation failed.' });
  });
});

describe('POST /api/explain-context', () => {
  beforeEach(() => jest.resetAllMocks());

  const A = "import { add } from './b';\nexport const total = add(1, 2);\n";
  const neighbor = (path: string) => ({ path, content: `export const ${path.replace(/\W/g, '')} = 1;\n` });
  const send = (extra: object) => request(app).post('/api/explain-context').set(authHeader())
    .send({ code: A, filename: 'src/a.ts', language: 'typescript', ...extra });

  it('explains a file with its imported neighbor and names both paths', async () => {
    reply('`src/a.ts` calls `add` from `src/b.ts`.');
    const response = await send({ neighbors: [{ path: 'src/b.ts', content: JS_SOURCE }] });

    expect(response.status).toBe(200);
    expect(response.body.explanation).toMatch(/^> Context: included src\/b\.ts\.\n\n/);
    expect(response.body.explanation).toContain('src/a.ts');
    expect(promptText()).toContain('Imported file: src/b.ts');
    expect(promptText()).toContain(JS_SOURCE);
  });

  it('says the file is explained alone when no valid neighbor is sent', async () => {
    reply('Adds two numbers.');
    const response = await send({ neighbors: [{ path: 42, content: 'x' }, { path: 'src/c.ts', content: ' ' }, null] });

    expect(response.status).toBe(200);
    expect(response.body.explanation).toBe('> No imported neighbor was included; this explains src/a.ts alone.\n\nAdds two numbers.');
    expect(promptText()).not.toContain('Imported file:');
  });

  it('sends only 3 neighbors and lists the rest as left out', async () => {
    reply('Explained.');
    const neighbors = ['n1.ts', 'n2.ts', 'n3.ts', 'n4.ts'].map(neighbor);
    const response = await send({ neighbors, omittedPaths: ['n5.ts', 7] });

    expect(response.status).toBe(200);
    expect(response.body.explanation).toMatch(
      /^> Context: included n1\.ts, n2\.ts, n3\.ts\. Left out \(limit 3\): n4\.ts, n5\.ts\.\n\n/,
    );
    expect(promptText()).toContain('Imported file: n3.ts');
    expect(promptText()).not.toContain('Imported file: n4.ts');
  });

  it('returns 400 for blank code and 401 without a JWT', async () => {
    const blank = await send({ code: '  ' });
    const noJwt = await request(app).post('/api/explain-context').send({ code: A });
    expect(blank.status).toBe(400);
    expect(blank.body.error).toBe('Code content is empty.');
    expect(noJwt.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when an included neighbor holds a private key, without calling Groq', async () => {
    const key = { path: 'src/key.ts', content: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n' };
    const response = await send({ neighbors: [neighbor('src/b.ts'), key] });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: SECRET_MESSAGE });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['the provider throws', () => mockCreate.mockRejectedValue(new Error(PROVIDER_DUMP))],
    ['the reply is empty', () => reply('  ')],
  ])('returns a safe 500 when %s', async (_label, arrange) => {
    arrange();
    const response = await send({});
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'AI error: Context explanation failed.' });
  });
});
