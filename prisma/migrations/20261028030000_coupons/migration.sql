-- Kupon promo top-up CTF.
-- Diskon mengurangi harga bayar (amountIdr), TIDAK mengurangi CTF yang diterima.
-- Pemakaian dikunci saat order dibuat (RESERVED) supaya kuota tidak bisa
-- dilampaui oleh banyak order pending, lalu dikonfirmasi saat lunas.
CREATE TYPE "CouponDiscountType" AS ENUM ('FIXED', 'PERCENT');
CREATE TYPE "CouponRedemptionStatus" AS ENUM ('RESERVED', 'CONFIRMED', 'RELEASED');

CREATE TABLE "Coupon" (
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT '',
  "discountType" "CouponDiscountType" NOT NULL,
  "discountValue" INTEGER NOT NULL,
  "maxDiscountIdr" INTEGER,
  "minAmountIdr" INTEGER NOT NULL DEFAULT 0,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "maxRedemptions" INTEGER,
  "redemptionCount" INTEGER NOT NULL DEFAULT 0,
  "maxPerUser" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Coupon_pkey" PRIMARY KEY ("code"),
  CONSTRAINT "Coupon_discount_value_check" CHECK ("discountValue" > 0),
  CONSTRAINT "Coupon_discount_percent_check"
    CHECK ("discountType" <> 'PERCENT' OR "discountValue" <= 100),
  CONSTRAINT "Coupon_max_redeptions_check"
    CHECK ("maxRedemptions" IS NULL OR "maxRedemptions" > 0)
);

CREATE INDEX "Coupon_isActive_endsAt_idx" ON "Coupon"("isActive", "endsAt");

CREATE TABLE "CouponRedemption" (
  "id" TEXT NOT NULL,
  "couponCode" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "status" "CouponRedemptionStatus" NOT NULL DEFAULT 'RESERVED',
  "amountIdr" INTEGER NOT NULL,
  "discountIdr" INTEGER NOT NULL,
  "paidAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CouponRedemption_orderId_key" ON "CouponRedemption"("orderId");
CREATE INDEX "CouponRedemption_couponCode_status_idx"
  ON "CouponRedemption"("couponCode", "status");
CREATE INDEX "CouponRedemption_couponCode_userId_idx"
  ON "CouponRedemption"("couponCode", "userId");
CREATE INDEX "CouponRedemption_userId_createdAt_idx"
  ON "CouponRedemption"("userId", "createdAt");

ALTER TABLE "CouponRedemption"
  ADD CONSTRAINT "CouponRedemption_couponCode_fkey"
  FOREIGN KEY ("couponCode") REFERENCES "Coupon"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Snapshot kupon pada order: kupon tidak pernah dihapus, hanya dinonaktifkan,
-- jadi kode disimpan sebagai string biasa (tanpa FK) agar riwayat tetap utuh.
ALTER TABLE "PaymentOrder"
  ADD COLUMN "couponCode" TEXT,
  ADD COLUMN "discountIdr" INTEGER NOT NULL DEFAULT 0;