-- CreateEnum
CREATE TYPE "CtfLedgerType" AS ENUM ('TOPUP', 'FESS_CHARGE', 'FESS_REFUND', 'ADMIN_ADJUSTMENT', 'MIGRATION', 'CHARGEBACK', 'CORRECTION');

-- CreateEnum
CREATE TYPE "PaymentOrderStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'FAILED', 'REFUNDED', 'PARTIAL_REFUND', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "PaymentEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'INVALID_SIGNATURE', 'FAILED');

-- CreateEnum
CREATE TYPE "FessChargeStatus" AS ENUM ('CHARGED', 'REFUNDED', 'REVERSED');

-- CreateEnum
CREATE TYPE "BaseRevenueEntryType" AS ENUM ('EARNING', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BaseRevenueEntryStatus" AS ENUM ('PENDING', 'AVAILABLE', 'REVERSED');

-- CreateEnum
CREATE TYPE "BasePayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Base" ADD COLUMN     "freeForever" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "freeForeverReason" TEXT,
ADD COLUMN     "freeForeverSetAt" TIMESTAMP(3),
ADD COLUMN     "freeForeverSetById" TEXT,
ADD COLUMN     "payoutBankAccountName" TEXT,
ADD COLUMN     "payoutBankAccountNumber" TEXT,
ADD COLUMN     "payoutBankChangeEffectiveAt" TIMESTAMP(3),
ADD COLUMN     "payoutBankName" TEXT,
ADD COLUMN     "payoutBankUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "payoutKycNote" TEXT,
ADD COLUMN     "payoutKycStatus" TEXT NOT NULL DEFAULT 'unverified',
ADD COLUMN     "payoutKycVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ADD COLUMN     "trialSource" TEXT,
ADD COLUMN     "trialStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Fess" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "SystemSetting" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "updatedById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "baseTrialUsedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CtfWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CtfWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CtfLedgerEntry" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CtfLedgerType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CtfLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packageCode" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "amountIdr" INTEGER NOT NULL,
    "ctfAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT,
    "paymentChannel" TEXT,
    "midtransTransactionId" TEXT,
    "midtransStatus" TEXT,
    "qrString" TEXT,
    "qrUrl" TEXT,
    "vaNumber" TEXT,
    "deeplinkUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "refundedAmountIdr" INTEGER,
    "refundReason" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "paymentOrderId" TEXT,
    "orderId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "PaymentEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "signatureValid" BOOLEAN NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FessCharge" (
    "id" TEXT NOT NULL,
    "fessId" TEXT,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "FessChargeStatus" NOT NULL DEFAULT 'CHARGED',
    "idempotencyKey" TEXT NOT NULL,
    "chargedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FessCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaseRevenueWallet" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "pendingIdr" INTEGER NOT NULL DEFAULT 0,
    "availableIdr" INTEGER NOT NULL DEFAULT 0,
    "lifetimeIdr" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BaseRevenueWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaseRevenueEntry" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "fessId" TEXT,
    "type" "BaseRevenueEntryType" NOT NULL DEFAULT 'EARNING',
    "amountIdr" INTEGER NOT NULL,
    "status" "BaseRevenueEntryStatus" NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "reversedById" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BaseRevenueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BasePayout" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "amountIdr" INTEGER NOT NULL,
    "feeIdr" INTEGER NOT NULL DEFAULT 0,
    "netIdr" INTEGER NOT NULL,
    "status" "BasePayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "bankName" TEXT NOT NULL,
    "bankAccountName" TEXT NOT NULL,
    "bankAccountNumber" TEXT NOT NULL,
    "requestKey" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "rejectionReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BasePayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CtfWallet_userId_key" ON "CtfWallet"("userId");

-- CreateIndex
CREATE INDEX "CtfWallet_updatedAt_idx" ON "CtfWallet"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CtfLedgerEntry_idempotencyKey_key" ON "CtfLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CtfLedgerEntry_walletId_createdAt_idx" ON "CtfLedgerEntry"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "CtfLedgerEntry_userId_createdAt_idx" ON "CtfLedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CtfLedgerEntry_referenceType_referenceId_idx" ON "CtfLedgerEntry"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_orderId_key" ON "PaymentOrder"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_midtransTransactionId_key" ON "PaymentOrder"("midtransTransactionId");

-- CreateIndex
CREATE INDEX "PaymentOrder_userId_createdAt_idx" ON "PaymentOrder"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentOrder_status_expiresAt_idx" ON "PaymentOrder"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PaymentOrder_createdAt_idx" ON "PaymentOrder"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_idempotencyKey_key" ON "PaymentEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentEvent_orderId_createdAt_idx" ON "PaymentEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentEvent_status_createdAt_idx" ON "PaymentEvent"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FessCharge_fessId_key" ON "FessCharge"("fessId");

-- CreateIndex
CREATE UNIQUE INDEX "FessCharge_idempotencyKey_key" ON "FessCharge"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FessCharge_userId_createdAt_idx" ON "FessCharge"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FessCharge_status_idx" ON "FessCharge"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BaseRevenueWallet_baseId_key" ON "BaseRevenueWallet"("baseId");

-- CreateIndex
CREATE INDEX "BaseRevenueWallet_updatedAt_idx" ON "BaseRevenueWallet"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BaseRevenueEntry_fessId_key" ON "BaseRevenueEntry"("fessId");

-- CreateIndex
CREATE UNIQUE INDEX "BaseRevenueEntry_idempotencyKey_key" ON "BaseRevenueEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BaseRevenueEntry_baseId_status_availableAt_idx" ON "BaseRevenueEntry"("baseId", "status", "availableAt");

-- CreateIndex
CREATE INDEX "BaseRevenueEntry_walletId_createdAt_idx" ON "BaseRevenueEntry"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "BaseRevenueEntry_type_createdAt_idx" ON "BaseRevenueEntry"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BasePayout_requestKey_key" ON "BasePayout"("requestKey");

-- CreateIndex
CREATE INDEX "BasePayout_baseId_status_createdAt_idx" ON "BasePayout"("baseId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BasePayout_status_createdAt_idx" ON "BasePayout"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BasePayout_requestedById_createdAt_idx" ON "BasePayout"("requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_actorId_createdAt_idx" ON "AdminAuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Base_trialEndsAt_idx" ON "Base"("trialEndsAt");

-- CreateIndex
CREATE INDEX "Base_freeForever_idx" ON "Base"("freeForever");

-- CreateIndex
CREATE UNIQUE INDEX "Fess_idempotencyKey_key" ON "Fess"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "Base" ADD CONSTRAINT "Base_freeForeverSetById_fkey" FOREIGN KEY ("freeForeverSetById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CtfWallet" ADD CONSTRAINT "CtfWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CtfLedgerEntry" ADD CONSTRAINT "CtfLedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CtfWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CtfLedgerEntry" ADD CONSTRAINT "CtfLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentOrderId_fkey" FOREIGN KEY ("paymentOrderId") REFERENCES "PaymentOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FessCharge" ADD CONSTRAINT "FessCharge_fessId_fkey" FOREIGN KEY ("fessId") REFERENCES "Fess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FessCharge" ADD CONSTRAINT "FessCharge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FessCharge" ADD CONSTRAINT "FessCharge_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CtfWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseRevenueWallet" ADD CONSTRAINT "BaseRevenueWallet_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "Base"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseRevenueEntry" ADD CONSTRAINT "BaseRevenueEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "BaseRevenueWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseRevenueEntry" ADD CONSTRAINT "BaseRevenueEntry_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "Base"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseRevenueEntry" ADD CONSTRAINT "BaseRevenueEntry_fessId_fkey" FOREIGN KEY ("fessId") REFERENCES "Fess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseRevenueEntry" ADD CONSTRAINT "BaseRevenueEntry_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasePayout" ADD CONSTRAINT "BasePayout_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "Base"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasePayout" ADD CONSTRAINT "BasePayout_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "BaseRevenueWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasePayout" ADD CONSTRAINT "BasePayout_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasePayout" ADD CONSTRAINT "BasePayout_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Security constraints
-- ---------------------------------------------------------------------------
ALTER TABLE "CtfWallet" ADD CONSTRAINT "CtfWallet_balance_nonnegative" CHECK ("balance" >= 0);
ALTER TABLE "CtfLedgerEntry" ADD CONSTRAINT "CtfLedgerEntry_amount_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "CtfLedgerEntry" ADD CONSTRAINT "CtfLedgerEntry_balance_after_nonnegative" CHECK ("balanceAfter" >= 0);
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_amounts_positive" CHECK ("amountIdr" > 0 AND "ctfAmount" > 0);
ALTER TABLE "FessCharge" ADD CONSTRAINT "FessCharge_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "BaseRevenueWallet" ADD CONSTRAINT "BaseRevenueWallet_pending_nonnegative" CHECK ("pendingIdr" >= 0);
ALTER TABLE "BaseRevenueWallet" ADD CONSTRAINT "BaseRevenueWallet_lifetime_nonnegative" CHECK ("lifetimeIdr" >= 0);
ALTER TABLE "BaseRevenueEntry" ADD CONSTRAINT "BaseRevenueEntry_amount_nonzero" CHECK ("amountIdr" <> 0);
ALTER TABLE "BaseRevenueEntry" ADD CONSTRAINT "BaseRevenueEntry_earning_positive" CHECK ("type" <> 'EARNING' OR "amountIdr" > 0);
ALTER TABLE "BasePayout" ADD CONSTRAINT "BasePayout_amounts_valid" CHECK ("amountIdr" > 0 AND "feeIdr" >= 0 AND "netIdr" >= 0);

-- ---------------------------------------------------------------------------
-- Backfill: legacy User.balance (Float CTF) -> CtfWallet (integer CTF)
-- Fractional balances are rounded down so the migration never creates CTF.
-- Negative balances are clamped to 0 and audited.
-- ---------------------------------------------------------------------------
INSERT INTO "CtfWallet" ("id", "userId", "balance", "createdAt", "updatedAt")
SELECT 'ctfwallet_' || "id", "id", GREATEST(0, FLOOR("balance"))::int, NOW(), NOW()
FROM "User"
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "CtfLedgerEntry" (
  "id", "walletId", "userId", "type", "amount", "balanceAfter",
  "referenceType", "referenceId", "idempotencyKey", "metadata", "createdAt"
)
SELECT
  'ctfledger_migration_' || w."userId",
  w."id",
  w."userId",
  'MIGRATION',
  w."balance",
  w."balance",
  'migration',
  w."userId",
  'migration:user:' || w."userId",
  jsonb_build_object('source', 'User.balance', 'rawBalance', u."balance"),
  NOW()
FROM "CtfWallet" w
JOIN "User" u ON u."id" = w."userId"
WHERE w."balance" > 0
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "AdminAuditLog" ("id", "actorId", "action", "targetType", "targetId", "reason", "metadata", "createdAt")
SELECT
  'audit_migration_negative_' || "id",
  NULL,
  'MIGRATION_NEGATIVE_CTF_CLAMPED',
  'User',
  "id",
  'Saldo CTF legacy negatif diklem ke 0 saat migrasi',
  jsonb_build_object('rawBalance', "balance"),
  NOW()
FROM "User"
WHERE "balance" < 0;

INSERT INTO "AdminAuditLog" ("id", "actorId", "action", "targetType", "targetId", "reason", "metadata", "createdAt")
SELECT
  'audit_migration_fractional_' || "id",
  NULL,
  'MIGRATION_FRACTIONAL_CTF_ROUNDED_DOWN',
  'User',
  "id",
  'Saldo CTF legacy pecahan dibulatkan ke bawah saat migrasi',
  jsonb_build_object('rawBalance', "balance", 'migratedBalance', FLOOR("balance")::int),
  NOW()
FROM "User"
WHERE "balance" <> FLOOR("balance");

-- ---------------------------------------------------------------------------
-- Backfill: base revenue wallet and existing-base grace period
-- Legacy Base.balance / Base.revenue are intentionally NOT converted to IDR.
-- ---------------------------------------------------------------------------
INSERT INTO "BaseRevenueWallet" ("id", "baseId", "pendingIdr", "availableIdr", "lifetimeIdr", "createdAt", "updatedAt")
SELECT 'baserevenuewallet_' || "id", "id", 0, 0, 0, NOW(), NOW()
FROM "Base"
ON CONFLICT ("baseId") DO NOTHING;

UPDATE "Base"
SET
  "trialStartedAt" = COALESCE("trialStartedAt", NOW()),
  "trialEndsAt" = COALESCE("trialEndsAt", NOW() + INTERVAL '7 days'),
  "trialSource" = COALESCE("trialSource", 'grace')
WHERE "trialEndsAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Default system settings (admin can change later; env flags remain the kill switch)
-- ---------------------------------------------------------------------------
INSERT INTO "SystemSetting" ("key", "value", "description", "createdAt", "updatedAt")
VALUES
  ('payments_enabled', 'false'::jsonb, 'Kill switch top-up Midtrans', NOW(), NOW()),
  ('base_payouts_enabled', 'false'::jsonb, 'Kill switch payout base', NOW(), NOW()),
  ('base_revenue_per_fess_idr', '80'::jsonb, 'Pendapatan base per fess berbayar (IDR)', NOW(), NOW()),
  ('base_revenue_hold_days', '7'::jsonb, 'Masa hold revenue base (hari)', NOW(), NOW()),
  ('base_payout_min_idr', '50000'::jsonb, 'Minimum payout base (IDR)', NOW(), NOW()),
  ('base_trial_days', '7'::jsonb, 'Lama trial base baru (hari)', NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "AdminAuditLog" ("id", "action", "targetType", "reason", "metadata", "createdAt")
VALUES (
  'audit_migration_ctf_ledger_20261024',
  'MIGRATION_CTF_LEDGER',
  'System',
  'Migrasi User.balance ke CtfWallet dan pembuatan BaseRevenueWallet',
  jsonb_build_object(
    'ctfWallets', (SELECT COUNT(*) FROM "CtfWallet"),
    'baseRevenueWallets', (SELECT COUNT(*) FROM "BaseRevenueWallet"),
    'legacyBaseRevenueConverted', false
  ),
  NOW()
)
ON CONFLICT ("id") DO NOTHING;