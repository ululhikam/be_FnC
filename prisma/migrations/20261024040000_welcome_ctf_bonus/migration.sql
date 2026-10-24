-- Dedicated ledger type for the one-time new-user welcome bonus.
ALTER TYPE "CtfLedgerType" ADD VALUE IF NOT EXISTS 'WELCOME_BONUS';
