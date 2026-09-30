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

  it('returns a clamped score, summary, and normalized findings', async () => {
    const payload = {
      score: 142,
      summary: 'Readable, but one function does too much.',
      review: [
        { severity: 'warning', message: 'Nested conditionals.' },
        { severity: 'critical', message: 'God function.' },
        { severity: 'info', message: 'Magic number.' },
        { severity: 'banana', message: 'Ignored severity.' },
        { severity: 'high', message: '   ' },
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
    expect(response.body.review).toEqual([
      { severity: 'medium', message: 'Nested conditionals.' },
      { severity: 'high', message: 'God function.' },
      { severity: 'low', message: 'Magic number.' },
    ]);
    expect(mockCreate).toHaveBeenCalled();
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
