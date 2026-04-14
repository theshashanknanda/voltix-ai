import { Router, Request, Response } from 'express';
import { prisma } from '../database/prismaClient';
import requireAuth, { AuthenticatedRequest } from '../middleware/requireAuth';

const router = Router();

router.get('/analyses', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const analyses = await prisma.analysis.findMany({
      where: { userId: req.user?.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        repositoryUrl: true,
        createdAt: true,
        explanation: true,
        userId: true,
      },
    });
    res.json({ analyses });
  } catch (err: unknown) {
    console.error('[DB Error] GET /analyses', err);
    const message = err instanceof Error ? err.message : 'Database error';
    res.status(500).json({ error: `Failed to fetch analyses: ${message}` });
  }
});

/**
 * GET /api/analyses/:id
 * Returns a single analysis by ID belonging to the user.
 */
router.get('/analyses/:id', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const analysis = await prisma.analysis.findFirst({ 
      where: { id: id as string, userId: req.user?.id } 
    });
    if (!analysis) {
      res.status(404).json({ error: 'Analysis not found or unauthorized.' });
      return;
    }
    res.json({ analysis });
  } catch (err: unknown) {
    console.error('[DB Error] GET /analyses/:id', err);
    const message = err instanceof Error ? err.message : 'Database error';
    res.status(500).json({ error: `Failed to fetch analysis: ${message}` });
  }
});

export default router;
