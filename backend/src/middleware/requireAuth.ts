import 'dotenv/config';
import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set');
}

const unauthorized = (res: Response) => {
  res.status(401).json({ error: 'Unauthorized. Please login again.' });
};

const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    unauthorized(res);
    return;
  }

  const token = header.split(' ')[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload & { sub?: string; email?: string };

    if (!payload?.sub) {
      unauthorized(res);
      return;
    }

    req.user = {
      id: payload.sub,
      email: payload.email ?? '',
    };

    next();
  } catch (err: unknown) {
    console.error('[Auth Middleware Error]', err);
    unauthorized(res);
  }
};

export default requireAuth;