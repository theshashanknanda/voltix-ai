import request from 'supertest';
import app from '../index';
import mongoose from 'mongoose';

describe('Health Check API', () => {
  afterAll(async () => {
    // Close mongoose connection after tests complete to avoid open handles
    await mongoose.connection.close();
  });

  it('should return 200 OK from /health', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'OK');
  });

  it('should return a welcome message from /', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('message', 'Voltix-ai Backend is running!');
  });
});
