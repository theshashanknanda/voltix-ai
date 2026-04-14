-- Rename fileName to repositoryUrl while preserving existing data.
ALTER TABLE "analyses" RENAME COLUMN "fileName" TO "repositoryUrl";
