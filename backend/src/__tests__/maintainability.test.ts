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
    jest.resetAllMocks();
  });

  it('returns a clamped score, summary, and normalized smells', async () => {
    const payload = {
      score: 142,
      summary: 'Readable, but one function does too much.',
      smells: [
        { category: 'nested conditionals', severity: 'warning', title: 'Nested conditionals', detail: 'Three levels of ifs.', why: 'Nested branches make execution paths difficult to test.', bestPractice: 'Use guard clauses in `run` to return early for invalid input.' },
        { category: 'god function', severity: 'critical', title: 'God function', detail: 'run does everything.', why: 'Changes to validation can break persistence in the same function.', bestPractice: 'Extract `validateInput` and `saveResult`, then keep `run` as orchestration.' },
        { category: 'magic number', severity: 'info', title: 'Magic number', detail: '42 is unexplained.', why: 'The meaning of this threshold is hidden from future maintainers.', bestPractice: 'Replace `42` with a named constant that describes the threshold.' },
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
      { category: 'deep nesting', severity: 'medium', title: 'Nested conditionals', detail: 'Three levels of ifs.', why: 'Nested branches make execution paths difficult to test.', bestPractice: 'Use guard clauses in `run` to return early for invalid input.' },
      { category: 'long method', severity: 'high', title: 'God function', detail: 'run does everything.', why: 'Changes to validation can break persistence in the same function.', bestPractice: 'Extract `validateInput` and `saveResult`, then keep `run` as orchestration.' },
      { category: 'magic values', severity: 'low', title: 'Magic number', detail: '42 is unexplained.', why: 'The meaning of this threshold is hidden from future maintainers.', bestPractice: 'Replace `42` with a named constant that describes the threshold.' },
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
    expect(missing.body.error).toBe('Code content must be a non-empty string.');

    const blank = await request(app)
      .post('/api/maintainability')
      .set(authHeader())
      .send({ code: '   ', filename: 'blank.js' });

    expect(blank.status).toBe(400);
    expect(blank.body.error).toBe('Code content must be a non-empty string.');
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

  it.each([undefined, null, '', '   ', 42, {}, []])('rejects missing, empty, or non-string code: %p', async (code) => {
    const response = await request(app).post('/api/maintainability').set(authHeader()).send({ code });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Code content must be a non-empty string.');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each(['not-a-jwt', jwt.sign({ sub: 'test-user' }, 'wrong-secret'),
    jwt.sign({ sub: 'test-user' }, process.env.JWT_SECRET!, { expiresIn: -1 }),
  ])('rejects invalid or expired JWTs', async (token) => {
    const response = await request(app).post('/api/maintainability')
      .set('Authorization', `Bearer ${token}`).send({ code: 'const x = 1;' });
    expect(response.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  const validSmell = {
    category: 'deep nesting', severity: 'medium', title: 'Nested checks',
    detail: 'The handler has three nested checks.',
    why: 'More branches make the handler harder to test.',
    bestPractice: 'Use an early return for invalid input before processing the request.',
  };

  it.each(['why', 'bestPractice'])('rejects a finding with missing, blank, or non-string %s', async (field) => {
    for (const value of [undefined, '', '   ', null, 42, {}]) {
      mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
        score: 70, summary: 'Needs work.', smells: [validSmell, { ...validSmell, [field]: value }],
      }) } }] });
      const response = await request(app).post('/api/maintainability').set(authHeader())
        .send({ code: 'function run() {}' });
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'AI error: Maintainability analysis failed.' });
    }
  });

  it.each([
    { smells: undefined }, { smells: null }, { smells: {} }, { smells: [null] },
    { smells: [{ ...validSmell, detail: ' ' }] },
    { smells: [{ ...validSmell, category: '__proto__' }] },
    { smells: [{ ...validSmell, severity: 'constructor' }] },
    { score: null }, { score: true }, { score: 'NaN' }, { summary: ' ' },
  ])('safely rejects malformed results: %p', async (overrides) => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      score: 70, summary: 'Needs work.', smells: [validSmell], ...overrides,
    }) } }] });
    const response = await request(app).post('/api/maintainability').set(authHeader())
      .send({ code: 'function run() {}' });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'AI error: Maintainability analysis failed.' });
  });

  it('trims explanation fields and preserves Markdown rewrite guidance', async () => {
    const bestPractice = 'Extract a helper:\n\n```js\nfunction isValid(value) { return value != null; }\n```';
    mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      score: 70.4, summary: ' Needs work. ', smells: [{ ...validSmell,
        why: `  ${validSmell.why}  `, bestPractice: `  ${bestPractice}  `,
      }],
    }) } }] });
    const response = await request(app).post('/api/maintainability').set(authHeader())
      .send({ code: 'function run() {}' });
    expect(response.status).toBe(200);
    expect(response.body.score).toBe(70);
    expect(response.body.smells[0]).toEqual({ ...validSmell, bestPractice });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].messages[0].content).toContain('"bestPractice"');
  });

  it.each([
    ['test.js', 'javascript'], ['test.ts', 'typescript'], ['test.tsx', 'tsx'],
    ['test.jsx', 'jsx'], ['test.py', 'python'], ['Test.java', 'java'], ['test.go', 'go'],
  ])('returns enriched findings for a %s upload', async (filename, language) => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      score: 70, summary: 'Needs work.', smells: [validSmell],
    }) } }] });
    const response = await request(app).post('/api/maintainability').set(authHeader())
      .attach('file', Buffer.from('example source'), filename);
    expect(response.status).toBe(200);
    expect(response.body.smells).toEqual([validSmell]);
    expect(mockCreate.mock.calls[0][0].messages[0].content).toContain('```' + language);
  });

  it('rejects absent, empty, unsupported, and oversized uploads before calling Groq', async () => {
    const missing = await request(app).post('/api/maintainability').set(authHeader());
    const empty = await request(app).post('/api/maintainability').set(authHeader())
      .attach('file', Buffer.from('  '), 'empty.js');
    const unsupported = await request(app).post('/api/maintainability').set(authHeader())
      .attach('file', Buffer.from('binary'), 'file.exe');
    const oversized = await request(app).post('/api/maintainability').set(authHeader())
      .attach('file', Buffer.alloc(1024 * 1024 + 1), 'large.js');
    for (const response of [missing, empty, unsupported, oversized]) {
      expect(response.status).toBe(400);
      expect(response.body.error).toEqual(expect.any(String));
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([[], [{ message: { content: '' } }], [{ message: { content: null } }]])(
    'safely rejects empty provider choices: %p', async (...choices) => {
      mockCreate.mockResolvedValue({ choices });
      const response = await request(app).post('/api/maintainability').set(authHeader())
        .send({ code: 'const x = 1;' });
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'AI error: Maintainability analysis failed.' });
    },
  );

});
