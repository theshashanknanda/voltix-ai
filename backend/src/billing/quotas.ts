import { Prisma, User } from '@prisma/client';
import { prisma } from '../database/prismaClient';
import { HttpError } from '../errors';

export const PLAN_LIMITS = {
  FREE: { chatMessages: 20, savedProjects: 1 },
  PRO: { chatMessages: 500, savedProjects: 20 },
} as const;

// ponytail: AUTH_BYPASS local-only; infinite quotas so UI work isn't blocked by FREE plan.
export function limitsFor(plan: User['plan']) {
  if (process.env.AUTH_BYPASS === 'true') {
    return { chatMessages: Number.MAX_SAFE_INTEGER, savedProjects: Number.MAX_SAFE_INTEGER };
  }
  return PLAN_LIMITS[plan];
}

export const usageMonth = (now = new Date()) => now.toISOString().slice(0, 7);

// Serialize quota decisions and project writes for this user across all server
// instances. No network or model calls belong inside this short transaction.
export async function withUserLock<T>(userId: string, work: (tx: Prisma.TransactionClient, user: User) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(401, 'Unauthorized. Please login again.');
    return work(tx, user);
  });
}

export function projectLimitError(plan: User['plan']): HttpError {
  return new HttpError(402, plan === 'FREE'
    ? 'Your saved project limit has been reached. Upgrade your plan or remove a saved project.'
    : 'Your Pro saved project limit has been reached. Remove a saved project to import another.', 'PROJECT_LIMIT_REACHED');
}

export async function assertProjectCapacity(userId: string): Promise<void> {
  await withUserLock(userId, async (tx, user) => {
    const count = await tx.project.count({ where: { userId } });
    if (count >= limitsFor(user.plan).savedProjects) throw projectLimitError(user.plan);
  });
}

export async function getBillingUsage(userId: string) {
  return withUserLock(userId, async (tx, user) => {
    const month = usageMonth();
    const used = user.usageMonth === month ? user.chatMessagesUsed : 0;
    if (user.usageMonth !== month) {
      await tx.user.update({ where: { id: userId }, data: { usageMonth: month, chatMessagesUsed: 0 } });
    }
    const projects = await tx.project.count({ where: { userId } });
    const limits = limitsFor(user.plan);
    return {
      plan: user.plan, month, subscriptionStatus: user.subscriptionStatus,
      canManageBilling: Boolean(user.stripeCustomerId),
      limits,
      usage: { chatMessages: used, savedProjects: projects },
      remaining: { chatMessages: Math.max(0, limits.chatMessages - used), savedProjects: Math.max(0, limits.savedProjects - projects) },
    };
  });
}

/**
 * Integration point for #113/#114. Call after validation and secret checks,
 * immediately before the model call. One admitted question or edit generation
 * consumes one message, including a subsequent provider failure. Browsing and
 * applying an already-generated patch never call this function.
 */
export async function consumeChatMessage(userId: string) {
  return withUserLock(userId, async (tx, user) => {
    const month = usageMonth();
    const used = user.usageMonth === month ? user.chatMessagesUsed : 0;
    const limit = limitsFor(user.plan).chatMessages;
    if (used >= limit) {
      throw new HttpError(402, user.plan === 'FREE'
        ? 'Your monthly chat message limit has been reached. Upgrade your plan to continue.'
        : 'Your Pro monthly chat message limit has been reached. Your allowance resets next month.', 'CHAT_LIMIT_REACHED');
    }
    await tx.user.update({ where: { id: userId }, data: { usageMonth: month, chatMessagesUsed: used + 1 } });
    return { used: used + 1, remaining: limit - used - 1, limit, month };
  });
}
