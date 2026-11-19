import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../database/prismaClient';
import requireAuth, { AuthenticatedRequest } from '../middleware/requireAuth';
import { respondError } from '../errors';
import { EDITS_ONLY_MESSAGE, languageForFilename } from './explainCode';
import { containsSecret, isSecretPath, SECRET_MESSAGE } from '../secrets';

const router = Router();
export const projectFiles = {
  select: { path: true, name: true, content: true, language: true }, orderBy: { path: 'asc' },
} as const;
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
    const project = await prisma.project.findFirst({
      where: { id: String(req.params.id), userId: req.user!.id }, include: { files: projectFiles },
    });
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

function savedFiles(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
}

function ownsPath(files: Record<string, unknown>[], filePath: string): boolean {
  return Boolean(filePath) && !filePath.includes('..') && !filePath.startsWith('/') && !filePath.includes('\\')
    && files.some(file => file.path === filePath);
}

function markSuggestion(chat: unknown, filePath: string, status: 'applied' | 'dismissed') {
  if (!Array.isArray(chat)) return [];
  const next = chat.slice();
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const item = next[index];
    if (!item || typeof item !== 'object') continue;
    const suggestion = (item as { suggestion?: { path?: unknown; status?: unknown } }).suggestion;
    if (suggestion?.path === filePath && suggestion.status === 'pending') {
      next[index] = { ...item, suggestion: { ...suggestion, status } };
      break;
    }
  }
  return next;
}

router.post('/projects/:id/files', requireAuth, async (req: AuthenticatedRequest, res) => {
  const filePath = req.body?.path;
  const content = req.body?.content;
  if (typeof filePath !== 'string' || typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'The suggested edit is empty.' });
    return;
  }
  if (containsSecret(content) || isSecretPath(filePath)) {
    res.status(400).json({ error: SECRET_MESSAGE });
    return;
  }
  try {
    const project = await prisma.project.findFirst({
      where: { id: String(req.params.id), userId: req.user!.id },
      include: { files: true },
    });
    if (!project) { res.status(404).json({ error: 'Project not found.' }); return; }
    const files = savedFiles(project.files);
    if (!ownsPath(files, filePath)) { res.status(400).json({ error: 'That file is not in this project.' }); return; }
    if (!languageForFilename(filePath)) { res.status(400).json({ error: EDITS_ONLY_MESSAGE }); return; }
    const fileId = files.find(file => file.path === filePath)?.id;
    if (typeof fileId !== 'string') { res.status(400).json({ error: 'That file is not in this project.' }); return; }
    await prisma.projectFile.update({ where: { id: fileId }, data: { content } });
    await prisma.project.update({
      where: { id: project.id },
      data: { chat: markSuggestion(project.chat, filePath, 'applied') as Prisma.InputJsonValue },
    });
    res.json({ path: filePath, content, message: `Edit applied to ${filePath}.` });
  } catch (error) { respondError(res, error, 'Unable to save the file.'); }
});

router.post('/projects/:id/files/dismiss', requireAuth, async (req: AuthenticatedRequest, res) => {
  const filePath = typeof req.body?.path === 'string' ? req.body.path : '';
  if (!filePath) { res.status(400).json({ error: 'That file is not in this project.' }); return; }
  try {
    const project = await prisma.project.findFirst({ where: { id: String(req.params.id), userId: req.user!.id } });
    if (!project) { res.status(404).json({ error: 'Project not found.' }); return; }
    await prisma.project.update({
      where: { id: project.id },
      data: { chat: markSuggestion(project.chat, filePath, 'dismissed') as Prisma.InputJsonValue },
    });
    res.json({ message: 'Suggestion dismissed.' });
  } catch (error) { respondError(res, error, 'Unable to dismiss the suggestion.'); }
});

export default router;
