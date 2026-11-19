import { Prisma } from '@prisma/client';
import { PLAN_LIMITS, projectLimitError, withUserLock } from '../billing/quotas';
import { HttpError } from '../errors';

export type ImportedFile = { path: string; name: string; content: string; language: string };
export type ImportedProject = {
  source: 'github' | 'zip'; label: string; files: ImportedFile[];
  metadata: Prisma.InputJsonObject;
  repositoryUrl?: string;
};

// Minimal snapshot persistence shared with #111. Analysis rows remain solely
// saved explanations and are never used to count project slots.
export async function saveImportedProject(userId: string, input: ImportedProject) {
  if (!input.files.length) return null;
  if (Buffer.byteLength(JSON.stringify(input.files), 'utf8') > 20 * 1024 * 1024) {
    throw new HttpError(400, 'Imported project exceeds the 20 MB saved snapshot limit.');
  }
  return withUserLock(userId, async (tx, user) => {
    const count = await tx.project.count({ where: { userId } });
    if (count >= PLAN_LIMITS[user.plan].savedProjects) throw projectLimitError(user.plan);
    const project = await tx.project.create({ data: {
      userId, source: input.source, label: input.label,
      files: { create: input.files },
      metadata: input.metadata,
    } });
    // Preserve the previous GitHub import response contract for existing clients.
    const analysis = input.repositoryUrl ? await tx.analysis.create({ data: {
      userId, projectId: project.id, repositoryUrl: input.repositoryUrl,
      explanation: `Imported ${input.files.length} file(s) from ${input.label}`,
    } }) : null;
    return { projectId: project.id, analysisId: analysis?.id };
  });
}
