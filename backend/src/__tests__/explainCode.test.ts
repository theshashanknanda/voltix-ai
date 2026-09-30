import request from 'supertest';
import express from 'express';
import OpenAI from 'openai';

// TEST 3--- Explain API tests
// Define the mockCreate function before mocking the client
const mockCreate = jest.fn();

// Mock the Groq-compatible OpenAI client
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }));
});

// Mock requireAuth middleware
jest.mock('../middleware/requireAuth', () => ({
  __esModule: true,
  default: (req: any, _res: any, next: any) => {
    req.user = { id: 'test-user', email: 'test@example.com' };
    next();
  },
}));

// Import the router AFTER defining mocks
import explainRouter from '../api/explainCode';

const app = express();
app.use(express.json());
app.use('/api', explainRouter);

describe('POST /api/explain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function promptText(): string {
    const arg = mockCreate.mock.calls[0][0] as { messages: { content: string }[] };
    return arg.messages[0].content;
  }

  // TEST 3.1
  it('should explain a valid .js file successfully', async () => {
    const mockExplanation = 'This is a senior JavaScript explanation.';
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: mockExplanation } }],
    });

    const response = await request(app)
      .post('/api/explain')
      .attach('file', Buffer.from('const x = 10;'), 'test.js');

    expect(response.status).toBe(200);
    expect(response.body.explanation).toBe(mockExplanation);
    expect(response.body.explanation.length).toBeGreaterThan(0);
    expect(promptText()).toContain('following javascript code');
    expect(promptText()).toContain('```javascript');
  });

  it.each([
    ['widget.ts', 'typescript', 'const n: number = 1;'],
    ['Widget.tsx', 'tsx', 'export const A = () => null;'],
    ['Widget.jsx', 'jsx', 'export const A = () => null;'],
    ['script.py', 'python', 'n = 1\n'],
    ['Main.java', 'java', 'class Main {}'],
    ['main.go', 'go', 'package main\n'],
  ])('explains a %s upload and labels the prompt as %s', async (filename, language, source) => {
    const mockExplanation = `Explained ${language}.`;
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: mockExplanation } }],
    });

    const response = await request(app)
      .post('/api/explain')
      .attach('file', Buffer.from(source), filename);

    expect(response.status).toBe(200);
    expect(response.body.explanation).toBe(mockExplanation);
    expect(response.body.explanation.length).toBeGreaterThan(0);
    expect(promptText()).toContain(`following ${language} code`);
    expect(promptText()).toContain('```' + language);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // TEST 3.2
  it('should reject an unsupported extension with 400', async () => {
    const response = await request(app)
      .post('/api/explain')
      .attach('file', Buffer.from('MZ'), 'tool.exe');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Unsupported file type ".exe"');
    expect(response.body.error).toContain('.ts');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('should reject an empty allowed file with 400', async () => {
    const response = await request(app)
      .post('/api/explain')
      .attach('file', Buffer.from(''), 'empty.ts');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Uploaded file is empty.');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('explains a JSON body with the language the client sends', async () => {
    const mockExplanation = 'JSON path still works.';
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: mockExplanation } }],
    });

    const response = await request(app)
      .post('/api/explain')
      .send({ code: 'print(1)', filename: 'notes.txt', language: 'python' });

    expect(response.status).toBe(200);
    expect(response.body.explanation).toBe(mockExplanation);
    expect(promptText()).toContain('following python code');
    expect(promptText()).toContain('notes.txt');
  });

  // TEST 3.3
  it('should return 400 when no file is uploaded', async () => {
    const response = await request(app).post('/api/explain');
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('No file uploaded');
  });

  // TEST 3.4
  it('should handle AI service errors gracefully with 500 error', async () => {
    mockCreate.mockRejectedValue(new Error('API failure'));

    const response = await request(app)
      .post('/api/explain')
      .attach('file', Buffer.from('const y = 20;'), 'test.js');

    expect(response.status).toBe(500);
    expect(response.body.error).toContain('AI error');
  });
});
