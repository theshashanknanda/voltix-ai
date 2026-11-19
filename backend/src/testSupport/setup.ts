process.env.GROQ_API_KEY = 'test-groq-key';
// Tests must never connect to a database inherited from a developer's .env.
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/voltix_test';
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.JWT_SECRET = 'test-jwt-secret';
