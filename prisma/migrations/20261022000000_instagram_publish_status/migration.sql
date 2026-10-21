-- Status publikasi Instagram yang dapat dipantau admin.
ALTER TABLE "Fess"
  ADD COLUMN "igStatus" TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN "igError" TEXT,
  ADD COLUMN "igAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "igUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "igPayload" JSONB;

-- Fess lama yang sudah terbit ke IG dianggap published.
UPDATE "Fess"
SET "igStatus" = 'published',
    "igUpdatedAt" = NOW()
WHERE "postedToIg" = TRUE;

CREATE INDEX "Fess_igStatus_idx" ON "Fess"("igStatus");
