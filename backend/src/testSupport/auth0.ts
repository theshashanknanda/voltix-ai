import jwt from 'jsonwebtoken';

// Filename kept so existing suites keep importing authHeader from one place.
export const authHeader = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return {
    Authorization: `Bearer ${jwt.sign({ sub: 'test-user', email: 'test@example.com' }, secret, { expiresIn: '1h' })}`,
  };
};
