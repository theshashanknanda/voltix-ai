import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const issuer = 'https://voltix-tests.auth0.invalid/';
const audience = 'https://voltix-api.test';

// Route suites isolate provider verification and user provisioning. The auth
// suite separately exercises the real verifier against a local JWKS server.
jest.mock('../auth/auth0', () => ({
  UNAUTHORIZED: 'Unauthorized. Please login again.',
  accessTokenVerifier: () => (req: import('express').Request, _res: unknown, next: (error?: unknown) => void) => {
    try {
      const payload = jwt.verify(req.headers.authorization!.slice(7), keys.publicKey, { algorithms: ['RS256'], issuer, audience });
      req.auth = { payload, token: '', header: {} } as typeof req.auth;
      next();
    } catch (error) { next(error); }
  },
  resolveAuth0User: async () => ({ id: 'test-user', email: 'test@example.com' }),
}));

export const authHeader = () => ({ Authorization: `Bearer ${jwt.sign({ sub: 'google-oauth2|test-user' }, keys.privateKey, { algorithm: 'RS256', issuer, audience, expiresIn: '1h' })}` });
