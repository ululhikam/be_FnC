-- CreateIndex
-- "Mengikuti" feed: filter by followed baseIds + published status, newest first.
CREATE INDEX "Fess_baseId_status_createdAt_idx" ON "Fess"("baseId", "status", "createdAt");

-- DataRepair
-- fessCount harus mencerminkan fess yang terbit saja (bukan semua status).
UPDATE "Base" SET "fessCount" = (
  SELECT COUNT(*)::int
  FROM "Fess" f
  WHERE f."baseId" = "Base".id AND f.status IN ('published', 'approved')
);

UPDATE "User" SET "fessCount" = (
  SELECT COUNT(*)::int
  FROM "Fess" f
  WHERE f."userId" = "User".id AND f.status IN ('published', 'approved')
);
