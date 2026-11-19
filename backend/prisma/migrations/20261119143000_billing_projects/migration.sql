CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO');

ALTER TABLE "users"
  ADD COLUMN "plan" "Plan" NOT NULL DEFAULT 'FREE',
  ADD COLUMN "chatMessagesUsed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "usageMonth" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "stripeCustomerId" TEXT,
  ADD COLUMN "stripeSubscriptionId" TEXT,
  ADD COLUMN "stripeCheckoutSessionId" TEXT,
  ADD COLUMN "subscriptionStatus" TEXT;

CREATE UNIQUE INDEX "users_stripeCustomerId_key" ON "users"("stripeCustomerId");
CREATE UNIQUE INDEX "users_stripeSubscriptionId_key" ON "users"("stripeSubscriptionId");

CREATE TABLE "projects" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "files" JSONB NOT NULL,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "projects_userId_createdAt_idx" ON "projects"("userId", "createdAt");

CREATE TABLE "stripe_events" (
  "id" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);
