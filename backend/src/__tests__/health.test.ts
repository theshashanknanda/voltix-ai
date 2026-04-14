import request from 'supertest';
import app from '../index';

// TEST 2--- Health Check API tests
describe('Health Check API', () => {

  // TEST 2.1
  it('should return 200 OK from /health', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'OK');
  });

  // TEST 2.2
  it('should return a welcome message from /', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('message', 'Voltix-ai Backend is running!');
  });
});
