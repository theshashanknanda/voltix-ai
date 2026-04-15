import { Router, Response } from 'express';
import { prisma } from '../database/prismaClient';
import requireAuth, { AuthenticatedRequest } from '../middleware/requireAuth';

const router = Router();

type CreateAnalysisBody = {
  repositoryUrl?: string;
  explanation?: string;
};

const getGithubHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
};

const parseGithubRepoUrl = (rawUrl: string): { owner: string; repo: string } => {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch (err) {
    throw new Error('Invalid GitHub repository URL');
  }

  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
    throw new Error('Only GitHub repository URLs are supported');
  }

  const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (segments.length < 2) {
    throw new Error('GitHub repository URL must include owner and repository name');
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');

  if (!owner || !repo) {
    throw new Error('Invalid GitHub repository URL');
  }

  return { owner, repo };
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
  const { repositoryUrl, explanation } = req.body as CreateAnalysisBody;

  if (!repositoryUrl || !explanation) {
    res.status(400).json({ error: 'repositoryUrl and explanation are required.' });
    return;
  }

  try {
    const saved = await prisma.analysis.create({
      data: {
        repositoryUrl,
        explanation,
        userId: req.user?.id || null,
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
 * Returns the GitHub file tree for a saved analysis.
 */
router.get('/analyses/:id/files', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const analysis = await prisma.analysis.findFirst({
      where: { id: id as string, userId: req.user?.id },
      select: { repositoryUrl: true },
    });

    if (!analysis) {
      res.status(404).json({ error: 'Analysis not found or unauthorized.' });
      return;
    }

    let owner: string;
    let repo: string;

    try {
      ({ owner, repo } = parseGithubRepoUrl(analysis.repositoryUrl));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid repository URL';
      res.status(400).json({ error: message });
      return;
    }

    const headers = getGithubHeaders();
    const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (!repoResponse.ok) {
      res.status(400).json({ error: 'GitHub repository not found or inaccessible.' });
      return;
    }

    const repoData = await repoResponse.json();
    const defaultBranch = typeof repoData.default_branch === 'string' ? repoData.default_branch : 'main';

    const treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
      { headers },
    );

    if (!treeResponse.ok) {
      res.status(400).json({ error: 'Could not fetch repository file tree from GitHub.' });
      return;
    }

    const treeData = await treeResponse.json();
    if (!Array.isArray(treeData.tree)) {
      res.status(400).json({ error: 'GitHub repository tree response was malformed.' });
      return;
    }

    const files = (treeData.tree as Array<{ path: string; type: string }>).map((item) => ({
      path: item.path,
      type: item.type,
    }));

    res.json({ files });
  } catch (err: unknown) {
    console.error('[DB Error] GET /analyses/:id/files', err);
    const message = err instanceof Error ? err.message : 'Database error';
    res.status(500).json({ error: `Failed to fetch analysis files: ${message}` });
  }
});

export default router;
