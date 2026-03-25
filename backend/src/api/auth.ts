import 'dotenv/config';
import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../database/prismaClient';

interface AuthBody {
  email?: string;
  password?: string;
  name?: string;
}

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set');
}

const TOKEN_TTL = '1h';

const sanitizeEmail = (email: string) => email.trim().toLowerCase();

const issueToken = (userId: string, email: string) =>
  jwt.sign({ sub: userId, email }, JWT_SECRET, { expiresIn: TOKEN_TTL });

router.post(
  '/register',
  async (req: Request<unknown, unknown, AuthBody>, res: Response): Promise<void> => {
    const { email, password, name } = req.body ?? {};

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const normalizedEmail = sanitizeEmail(email);

    try {
      const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });

      if (existingUser) {
        res.status(409).json({ error: 'User already exists.' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.user.create({ data: { email: normalizedEmail, passwordHash, name: name || undefined } });
      res.status(201).json({ message: 'Registration successful.' });
    } catch (err: unknown) {
      console.error('[Register Error]', err);
      const isDuplicate = err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2002';
      if (isDuplicate) {
        res.status(409).json({ error: 'User already exists.' });
        return;
      }
      res.status(500).json({ error: 'Failed to register. Please try again.' });
    }
  },
);

router.post(
  '/login',
  async (req: Request<unknown, unknown, AuthBody>, res: Response): Promise<void> => {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    try {
      const normalizedEmail = sanitizeEmail(email);
      const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

      if (!user) {
        res.status(401).json({ error: 'Invalid credentials.' });
        return;
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);

      if (!isValid) {
        res.status(401).json({ error: 'Invalid credentials.' });
        return;
      }

      const token = issueToken(user.id, user.email);
      res.json({ token, expiresIn: TOKEN_TTL });
    } catch (err: unknown) {
      console.error('[Login Error]', err);
      res.status(500).json({ error: 'Failed to login. Please try again.' });
    }
  },
);

export default router;