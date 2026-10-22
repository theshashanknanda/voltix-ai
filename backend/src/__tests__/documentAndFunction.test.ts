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
