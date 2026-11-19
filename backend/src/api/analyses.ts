import { Router, Response } from 'express';
import { prisma } from '../database/prismaClient';
import requireAuth, { AuthenticatedRequest } from '../middleware/requireAuth';
import { projectFiles } from './projects';

const router = Router();

type CreateAnalysisBody = {
  repositoryUrl?: string;
  explanation?: string;
  projectId?: string;
};

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
 * POST /api/analyses
 * Creates a saved analysis for the current user.
 */
router.post('/analyses', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { repositoryUrl, explanation, projectId } = req.body as CreateAnalysisBody;

  if (!repositoryUrl || !explanation) {
    res.status(400).json({ error: 'repositoryUrl and explanation are required.' });
    return;
  }

  try {
    // Linking another user's project would expose its files via /analyses/:id/files.
    if (projectId && !(await prisma.project.findFirst({ where: { id: String(projectId), userId: req.user!.id }, select: { id: true } }))) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const saved = await prisma.analysis.create({
      data: {
        repositoryUrl,
        explanation,
        userId: req.user?.id || null,
        projectId: projectId ? String(projectId) : null,
      },
    });
    res.status(201).json({ analysis: saved });
  } catch (err: unknown) {
    console.error('[DB Error] POST /analyses', err);
    const message = err instanceof Error ? err.message : 'Database error';
    res.status(500).json({ error: `Failed to save analysis: ${message}` });
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

/**
 * DELETE /api/analyses/:id
 * Removes a saved analysis owned by the current user.
 */
router.delete('/analyses/:id', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const result = await prisma.analysis.deleteMany({
      where: { id: id as string, userId: req.user?.id },
    });

    if (result.count === 0) {
      res.status(404).json({ error: 'Analysis not found or unauthorized.' });
      return;
    }

    res.json({ ok: true });
  } catch (err: unknown) {
    console.error('[DB Error] DELETE /analyses/:id', err);
    const message = err instanceof Error ? err.message : 'Database error';
    res.status(500).json({ error: `Failed to delete analysis: ${message}` });
  }
});

/**
 * GET /api/analyses/:id/files
 * Returns the files saved with the analysis's imported project. Never calls GitHub.
 */
router.get('/analyses/:id/files', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const analysis = await prisma.analysis.findFirst({
      where: { id: id as string, userId: req.user?.id },
      select: { project: { select: { files: projectFiles } } },
    });

    if (!analysis) {
      res.status(404).json({ error: 'Analysis not found or unauthorized.' });
      return;
    }

    res.json({ files: analysis.project?.files ?? [] });
  } catch (err: unknown) {
    console.error('[DB Error] GET /analyses/:id/files', err);
    const message = err instanceof Error ? err.message : 'Database error';
    res.status(500).json({ error: `Failed to fetch analysis files: ${message}` });
  }
});

export default router;
