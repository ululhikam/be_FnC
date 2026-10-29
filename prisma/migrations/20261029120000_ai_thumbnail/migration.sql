-- Thumbnail cover Instagram + ledger AI (additive, tanpa DROP).
-- Base.thumbnailMode = opt-out per base: auto | no_ai | off.
ALTER TABLE "Base" ADD COLUMN     "thumbnailMode" TEXT NOT NULL DEFAULT 'auto';

-- Slide cover indeks 0 (foto + judul + watermark). Judul final, tidak bisa diedit.
ALTER TABLE "Fess" ADD COLUMN     "thumbnailError" TEXT,
ADD COLUMN     "thumbnailGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "thumbnailPromptVersion" TEXT,
ADD COLUMN     "thumbnailSourceMediaId" TEXT,
ADD COLUMN     "thumbnailStatus" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN     "thumbnailTitle" TEXT,
ADD COLUMN     "thumbnailUrl" TEXT,
ADD COLUMN     "thumbnailVersion" INTEGER NOT NULL DEFAULT 0;

-- Ledger panggilan AI: cache (kind + inputHash unik), kuota, dan laporan.
CREATE TABLE "AiGeneration" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "output" JSONB NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6),
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGeneration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiGeneration_kind_createdAt_idx" ON "AiGeneration"("kind", "createdAt");
CREATE INDEX "AiGeneration_targetType_targetId_idx" ON "AiGeneration"("targetType", "targetId");
CREATE UNIQUE INDEX "AiGeneration_kind_inputHash_key" ON "AiGeneration"("kind", "inputHash");
CREATE INDEX "Fess_thumbnailStatus_idx" ON "Fess"("thumbnailStatus");