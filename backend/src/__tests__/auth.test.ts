import express from 'express';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
jest.mock('../database/prismaClient', () => ({
  prisma: { user: { findFirst: mockFindFirst, create: mockCreate } },
}));

import authRouter from '../api/auth';

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

const user = {
  id: 'user-1',
  email: 'dev@example.com',
  passwordHash: '',
};

beforeAll(async () => {
  user.passwordHash = await bcrypt.hash('secret-pass', 4);
});

beforeEach(() => {
  jest.clearAllMocks();
});

it('registers a new user', async () => {
  mockFindFirst.mockResolvedValue(null);
  mockCreate.mockResolvedValue({ id: user.id, email: user.email });
  const response = await request(app).post('/api/auth/register').send({
    email: 'Dev@Example.com',
    password: 'secret-pass',
    name: 'Dev',
  });
  expect(response.status).toBe(201);
  expect(mockCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({ email: 'dev@example.com', name: 'Dev' }),
  });
});

it('logs in and returns a JWT whose sub is the user id', async () => {
  mockFindFirst.mockResolvedValue(user);
  const response = await request(app).post('/api/auth/login').send({
    email: user.email,
    password: 'secret-pass',
  });
  expect(response.status).toBe(200);
  const payload = jwt.verify(response.body.token, process.env.JWT_SECRET!) as jwt.JwtPayload;
  expect(payload.sub).toBe(user.id);
  expect(payload.email).toBe(user.email);
});

it('rejects bad passwords', async () => {
  mockFindFirst.mockResolvedValue(user);
  const response = await request(app).post('/api/auth/login').send({
    email: user.email,
    password: 'wrong',
  });
  expect(response.status).toBe(401);
});

it('serves /me for a valid JWT', async () => {
  const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET!, { expiresIn: '1h' });
  const response = await request(app).get('/api/auth/me').auth(token, { type: 'bearer' });
  expect(response.status).toBe(200);
  expect(response.body.user).toEqual({ id: user.id, email: user.email });
});

it('rejects /me without a token', async () => {
  const response = await request(app).get('/api/auth/me');
  expect(response.status).toBe(401);
});
