-- Track the first publication time so a fess that was ever published can never
-- receive a CTF refund after it is rejected or deleted. Existing published
-- rows are backfilled; the exact time is not important, only that it is set.
ALTER TABLE "Fess"
ADD COLUMN "publishedAt" TIMESTAMP(3);

UPDATE "Fess"
SET "publishedAt" = "createdAt"
WHERE "status" IN ('published', 'approved')
  AND "publishedAt" IS NULL;
