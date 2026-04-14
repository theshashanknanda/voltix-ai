import request from 'supertest';
import express from 'express';
import OpenAI from 'openai';

// TEST 3--- Explain API tests
// Define the mockCreate function before mocking the client
const mockCreate = jest.fn();
const mockPrismaCreate = jest.fn().mockResolvedValue({ id: 'test-analysis-id' });

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

// Mock Prisma client so tests do not require a real database connection
jest.mock('../database/prismaClient', () => ({
  __esModule: true,
  prisma: {
    analysis: {
      create: mockPrismaCreate,
    },
  },
}));

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
    expect(response.body).toHaveProperty('explanation', mockExplanation);
    expect(mockCreate).toHaveBeenCalled();
  });

  // TEST 3.2
  it('should reject non-.js files with 400 error', async () => {
    const response = await request(app)
      .post('/api/explain')
      .attach('file', Buffer.from('hello world'), 'test.txt');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Only .js files are allowed');
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
