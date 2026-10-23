-- Track IDR that has been reserved by an open payout request. Keeping this
-- separate from availableIdr makes the liability explicit and lets payout
-- rejection/failure release exactly the amount that was reserved.
ALTER TABLE "BaseRevenueWallet"
ADD COLUMN "reservedIdr" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "BaseRevenueWallet"
ADD CONSTRAINT "BaseRevenueWallet_reserved_nonnegative" CHECK ("reservedIdr" >= 0);
