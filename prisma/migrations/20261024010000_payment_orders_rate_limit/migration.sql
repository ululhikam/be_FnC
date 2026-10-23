-- AlterTable
ALTER TABLE "PaymentOrder" ADD COLUMN     "actions" JSONB,
ADD COLUMN     "billKey" TEXT,
ADD COLUMN     "billerCode" TEXT,
ADD COLUMN     "requestKey" TEXT;

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_requestKey_key" ON "PaymentOrder"("requestKey");

-- Distributed rate limiter safety constraint
ALTER TABLE "RateLimitBucket" ADD CONSTRAINT "RateLimitBucket_count_nonnegative" CHECK ("count" >= 0);