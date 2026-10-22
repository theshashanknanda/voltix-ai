import { containsSecret, isSecretPath } from '../secrets';

describe('isSecretPath', () => {
  it.each(['.env', 'config/.env.production', 'keys/id_rsa', 'id_ed25519', 'certs/server.pem', 'tls.key', 'a/b.p12', 'c.PFX'])(
    'flags %s', (p) => expect(isSecretPath(p)).toBe(true),
  );
  it.each(['src/index.ts', 'env.ts', 'id_rsa.pub', 'keys.ts', 'docs/.envrc'])(
    'allows %s', (p) => expect(isSecretPath(p)).toBe(false),
  );
});

describe('containsSecret', () => {
  it.each([
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'password: "hunter2xyz"',
    '{ "token": "abc123def456" }',
    "API_KEY = 'sk-test-not-real'",
    'GITHUB_TOKEN=ghp_notarealtoken123',
    'db_passwd="changeme1"',
  ])('flags %p', (text) => expect(containsSecret(text)).toBe(true));

  it.each([
    'const JWT_SECRET = process.env.JWT_SECRET;',
    'API_KEY=os.environ["API_KEY"]',
    'TOKEN=${GITHUB_TOKEN}',
    "passwordError: 'Password must be 8 characters'",
    'if (token === "abcdefghij") {}',
    'password: "short"',
    '-----BEGIN PUBLIC KEY-----',
  ])('allows %p', (text) => expect(containsSecret(text)).toBe(false));
});
