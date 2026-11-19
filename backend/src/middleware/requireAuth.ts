import 'dotenv/config';
import { Request, Response, NextFunction } from 'express';
import { accessTokenVerifier, resolveAuth0User, UNAUTHORIZED } from '../auth/auth0';
import { prisma } from '../database/prismaClient';
import { HttpError } from '../errors';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string };
}

const BYPASS_SUBJECT = 'local-bypass';

// ponytail: local-only AUTH_BYPASS for UI work without Auth0. Do not enable in production.
async function resolveBypassUser() {
  const existing = await prisma.user.findUnique({ where: { auth0UserId: BYPASS_SUBJECT } });
  if (existing) return existing;
  return prisma.user.create({
    data: { auth0UserId: BYPASS_SUBJECT, email: 'dev@localhost', name: 'Local Dev' },
  });
}

const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (process.env.AUTH_BYPASS === 'true') {
    void resolveBypassUser().then(user => {
      req.user = { id: user.id, email: user.email };
      next();
    }).catch((failure: unknown) => {
      console.error('[Auth bypass user lookup failed]', failure);
      res.status(503).json({ error: 'Sign-in is temporarily unavailable. Please try again.' });
    });
    return;
  }
  const match = req.headers.authorization?.match(/^Bearer (\S+)$/);
  if (!match) {
    res.status(401).json({ error: UNAUTHORIZED });
    return;
  }
  try {
    accessTokenVerifier()(req, res, (error?: unknown) => {
      if (error || !req.auth?.payload.sub) {
        res.status(401).json({ error: UNAUTHORIZED });
        return;
      }
      void resolveAuth0User(req.auth.payload.sub, match[1]).then(user => {
        // Preserve the internal UUID used by project ownership and billing.
        req.user = { id: user.id, email: user.email };
        next();
      }).catch((failure: unknown) => {
        if (failure instanceof HttpError) {
          res.status(failure.status).json({ error: failure.message });
        } else {
          console.error('[Auth user lookup failed]', failure);
          res.status(503).json({ error: 'Sign-in is temporarily unavailable. Please try again.' });
        }
      });
    });
  } catch (error) {
    res.status(error instanceof HttpError ? error.status : 401).json({
      error: error instanceof HttpError ? error.message : UNAUTHORIZED,
    });
  }
};

export default requireAuth;
