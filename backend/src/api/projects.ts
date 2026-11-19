import { Router } from 'express';
import { prisma } from '../database/prismaClient';
import requireAuth, { AuthenticatedRequest } from '../middleware/requireAuth';
import { respondError } from '../errors';

const router = Router();
router.get('/projects', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const projects = await prisma.project.findMany({
      where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' },
      select: { id: true, source: true, label: true, createdAt: true },
    });
    res.json({ projects });
  } catch (error) { respondError(res, error, 'Unable to load saved projects.'); }
});
router.get('/projects/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const project = await prisma.project.findFirst({ where: { id: String(req.params.id), userId: req.user!.id } });
    if (!project) { res.status(404).json({ error: 'Project not found.' }); return; }
    res.json({ project });
  } catch (error) { respondError(res, error, 'Unable to load saved project.'); }
});
router.delete('/projects/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const deleted = await prisma.project.deleteMany({ where: { id: String(req.params.id), userId: req.user!.id } });
    if (!deleted.count) { res.status(404).json({ error: 'Project not found.' }); return; }
    res.json({ ok: true });
  } catch (error) { respondError(res, error, 'Unable to remove saved project.'); }
});
export default router;
