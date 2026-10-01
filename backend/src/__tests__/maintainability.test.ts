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

import maintainabilityRouter from '../api/maintainability';

const app = express();
app.use(express.json());
app.use('/api', maintainabilityRouter);

const authHeader = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  const token = jwt.sign({ sub: 'test-user', email: 'test@example.com' }, secret);
  return { Authorization: `Bearer ${token}` };
};

describe('POST /api/maintainability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a clamped score, summary, and normalized smells', async () => {
    const payload = {
      score: 142,
      summary: 'Readable, but one function does too much.',
      smells: [
        { category: 'nested conditionals', severity: 'warning', title: 'Nested conditionals', detail: 'Three levels of ifs.' },
        { category: 'god function', severity: 'critical', title: 'God function', detail: 'run does everything.' },
        { category: 'magic number', severity: 'info', title: 'Magic number', detail: '42 is unexplained.' },
        { category: 'spaghetti', severity: 'high', title: 'Unknown category', detail: 'Dropped.' },
        { category: 'poor naming', severity: 'banana', title: 'Bad name', detail: 'Dropped severity.' },
        { category: 'duplication', severity: 'high', title: '   ', detail: 'Blank title.' },
        { category: 'duplication', severity: 'low', title: 'Copied block', detail: '   ' },
      ],
    };
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '```json\n' + JSON.stringify(payload) + '\n```' } }],
    });

    const response = await request(app)
      .post('/api/maintainability')
      .set(authHeader())
      .send({ code: 'function run(){ return 1 }', filename: 'run.js', language: 'javascript' });

    expect(response.status).toBe(200);
    expect(response.body.score).toBe(100);
    expect(response.body.summary).toBe(payload.summary);
    expect(response.body.smells).toEqual([
      { category: 'deep nesting', severity: 'medium', title: 'Nested conditionals', detail: 'Three levels of ifs.' },
      { category: 'long method', severity: 'high', title: 'God function', detail: 'run does everything.' },
      { category: 'magic values', severity: 'low', title: 'Magic number', detail: '42 is unexplained.' },
    ]);
    expect(mockCreate).toHaveBeenCalled();
  });

  it('returns 200 with an empty smells list when the file is clean', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            score: 92,
            summary: 'Short and easy to follow.',
            smells: [],
          }),
        },
      }],
    });

    const response = await request(app)
      .post('/api/maintainability')
      .set(authHeader())
      .send({ code: 'function add(a, b) { return a + b; }', filename: 'add.js' });

    expect(response.status).toBe(200);
    expect(response.body.summary).toBe('Short and easy to follow.');
    expect(response.body.smells).toEqual([]);
  });

  it('returns 400 when code is missing or blank', async () => {
    const missing = await request(app)
      .post('/api/maintainability')
      .set(authHeader())
      .send({ filename: 'empty.js' });

    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe('Code content is empty.');

    const blank = await request(app)
      .post('/api/maintainability')
      .set(authHeader())
      .send({ code: '   ', filename: 'blank.js' });

    expect(blank.status).toBe(400);
    expect(blank.body.error).toBe('Code content is empty.');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 401 when no JWT is sent', async () => {
    const response = await request(app)
      .post('/api/maintainability')
      .send({ code: 'const x = 1;', filename: 'a.js' });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized. Please login again.');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns a safe 500 when the provider throws', async () => {
    const providerDump = 'SECRET_PROVIDER_DUMP_groq-timeout-xyz';
    mockCreate.mockRejectedValue(new Error(providerDump));

    const response = await request(app)
      .post('/api/maintainability')
      .set(authHeader())
      .send({ code: 'const y = 2;', filename: 'b.js' });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('AI error: Maintainability analysis failed.');
    expect(JSON.stringify(response.body)).not.toContain(providerDump);
  });

  it('returns a safe 500 when the model output is unusable', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'not json at all' } }],
    });

    const response = await request(app)
      .post('/api/maintainability')
      .set(authHeader())
      .send({ code: 'const z = 3;', filename: 'c.js' });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('AI error: Maintainability analysis failed.');
    expect(JSON.stringify(response.body)).not.toContain('not json');
  });
});
