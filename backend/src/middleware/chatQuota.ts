import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from './requireAuth';
import { consumeChatMessage } from '../billing/quotas';
import { respondError } from '../errors';

// Mount after requireAuth AND request validation, before chat/edit model work.
// Exported for #113/#114; no placeholder chat endpoint is shipped.
export default async function chatQuota(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized. Please login again.' });
    return;
  }
  try {
    const usage = await consumeChatMessage(req.user.id);
    res.setHeader('X-Chat-Messages-Remaining', usage.remaining);
    next();
  } catch (error) {
    respondError(res, error, 'Unable to check message usage. Please try again.');
  }
}
