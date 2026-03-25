import 'dotenv/config';
import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User';

interface AuthBody {
  email?: string;
  password?: string;
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
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const normalizedEmail = sanitizeEmail(email);

    try {
      const existingUser = await User.findOne({ email: normalizedEmail }).lean();

      if (existingUser) {
        res.status(409).json({ error: 'User already exists.' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      await User.create({ email: normalizedEmail, passwordHash });
      res.status(201).json({ message: 'Registration successful.' });
    } catch (err: unknown) {
      console.error('[Register Error]', err);
      const isDuplicate = err instanceof Error && 'code' in err && (err as { code?: number }).code === 11000;
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
      const user = await User.findOne({ email: normalizedEmail });

      if (!user) {
        res.status(401).json({ error: 'Invalid credentials.' });
        return;
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);

      if (!isValid) {
        res.status(401).json({ error: 'Invalid credentials.' });
        return;
      }

      const token = issueToken(user._id.toString(), user.email);
      res.json({ token, expiresIn: TOKEN_TTL });
    } catch (err: unknown) {
      console.error('[Login Error]', err);
      res.status(500).json({ error: 'Failed to login. Please try again.' });
    }
  },
);

export default router;