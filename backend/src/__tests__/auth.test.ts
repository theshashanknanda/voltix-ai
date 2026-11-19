import { createServer, Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mockFind = jest.fn();
const mockCreate = jest.fn();
jest.mock('../database/prismaClient', () => ({ prisma: { user: { findUnique: mockFind, create: mockCreate } } }));
import authRouter from '../api/auth';
import { UNAUTHORIZED } from '../auth/auth0';

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'auth0-test', alg: 'RS256', use: 'sig' };
let server: Server;
let issuer: string;
let profileFailure = false;
let profile: object;
const audience = 'https://voltix-api.test';
const user = { id: 'internal-uuid', email: 'dev@example.com', auth0UserId: 'google-oauth2|123' };
const token = (options: jwt.SignOptions = {}, sub = user.auth0UserId) => jwt.sign({ sub }, keys.privateKey, {
  algorithm: 'RS256', issuer, audience, expiresIn: '1h', keyid: 'auth0-test', ...options,
});

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/.well-known/openid-configuration') res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}jwks` }));
    else if (req.url === '/jwks') res.end(JSON.stringify({ keys: [jwk] }));
    else if (req.url === '/userinfo') { res.statusCode = profileFailure ? 503 : 200; res.end(JSON.stringify(profile)); }
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  process.env.AUTH0_ISSUER_BASE_URL = issuer;
  process.env.AUTH0_AUDIENCE = audience;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => {
  jest.clearAllMocks();
  profileFailure = false;
  profile = { sub: user.auth0UserId, email: 'Dev@Example.com', name: 'Developer' };
  mockFind.mockResolvedValue(null);
  mockCreate.mockResolvedValue(user);
});

it('verifies an Auth0 RS256 token, creates a user once, and preserves its internal UUID', async () => {
  const first = await request(app).get('/api/auth/me').auth(token(), { type: 'bearer' });
  expect(first.status).toBe(200);
  expect(first.body.user.id).toBe(user.id);
  expect(mockCreate).toHaveBeenCalledWith({ data: { auth0UserId: user.auth0UserId, email: 'dev@example.com', name: 'Developer' } });
  mockFind.mockResolvedValue(user);
  const second = await request(app).get('/api/auth/me').auth(token(), { type: 'bearer' });
  expect(second.status).toBe(200);
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

it.each(['missing', 'malformed', 'expired', 'audience', 'issuer', 'legacy', 'signature'])(
  'rejects %s tokens with 401 before provisioning a user', async kind => {
    let value: string | undefined;
    if (kind === 'malformed') value = 'not-a-token';
    if (kind === 'expired') value = token({ expiresIn: -1 });
    if (kind === 'audience') value = token({ audience: 'other-api' });
    if (kind === 'issuer') value = token({ issuer: 'https://other-tenant.test/' });
    if (kind === 'legacy') value = jwt.sign({ sub: user.id }, 'old-secret');
    if (kind === 'signature') value = jwt.sign({ sub: user.auth0UserId }, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey, {
      algorithm: 'RS256', issuer, audience, expiresIn: '1h', keyid: 'auth0-test',
    });
    const req = request(app).get('/api/auth/me');
    if (value) req.auth(value, { type: 'bearer' });
    const response = await req;
    expect(response.status).toBe(401);
    expect(response.body.error).toBe(UNAUTHORIZED);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockFind).not.toHaveBeenCalled();
  },
);

it('does not create a partial user when the profile provider is unavailable', async () => {
  profileFailure = true;
  expect((await request(app).get('/api/auth/me').auth(token(), { type: 'bearer' })).status).toBe(503);
  expect(mockCreate).not.toHaveBeenCalled();
});
it('rejects a profile for a different subject', async () => {
  profile = { sub: 'github|other', email: 'dev@example.com' };
  expect((await request(app).get('/api/auth/me').auth(token(), { type: 'bearer' })).status).toBe(401);
  expect(mockCreate).not.toHaveBeenCalled();
});
it('reuses a concurrently created identity', async () => {
  mockCreate.mockRejectedValue({ code: 'P2002' });
  mockFind.mockResolvedValueOnce(null).mockResolvedValueOnce(user);
  expect((await request(app).get('/api/auth/me').auth(token(), { type: 'bearer' })).status).toBe(200);
});
it('keeps provider identities separate even when their email matches', async () => {
  const githubUser = { ...user, id: 'github-internal-uuid', auth0UserId: 'github|456' };
  profile = { sub: githubUser.auth0UserId, email: user.email };
  mockCreate.mockResolvedValue(githubUser);
  const response = await request(app).get('/api/auth/me').auth(token({}, githubUser.auth0UserId), { type: 'bearer' });
  expect(response.status).toBe(200);
  expect(response.body.user.id).toBe(githubUser.id);
  expect(mockFind).toHaveBeenCalledWith({ where: { auth0UserId: githubUser.auth0UserId } });
});
it.each(['login', 'register'])('disables password %s', async path => {
  expect((await request(app).post(`/api/auth/${path}`).send({ email: user.email, password: 'old-password' })).status).toBe(410);
  expect(mockCreate).not.toHaveBeenCalled();
});
