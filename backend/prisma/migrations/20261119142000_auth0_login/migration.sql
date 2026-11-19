-- Auth0 subjects are the identity key. Matching emails do not link accounts.
DROP INDEX "users_email_key";
CREATE INDEX "users_email_idx" ON "users"("email");
ALTER TABLE "users"
  ALTER COLUMN "passwordHash" DROP NOT NULL,
  ADD COLUMN "auth0UserId" TEXT;
CREATE UNIQUE INDEX "users_auth0UserId_key" ON "users"("auth0UserId");
