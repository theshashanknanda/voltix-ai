CREATE TABLE "project_files" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  CONSTRAINT "project_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_files_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "project_files_projectId_idx" ON "project_files"("projectId");

-- Move existing JSON snapshots into rows before dropping the column.
INSERT INTO "project_files" ("id", "projectId", "path", "name", "content", "language")
SELECT gen_random_uuid()::text, p."id", f->>'path', f->>'name', f->>'content', f->>'language'
FROM "projects" p, jsonb_array_elements(p."files") f;

ALTER TABLE "projects" DROP COLUMN "files";

ALTER TABLE "analyses" ADD COLUMN "projectId" TEXT;
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
