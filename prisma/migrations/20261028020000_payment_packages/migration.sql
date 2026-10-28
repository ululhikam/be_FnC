-- Paket top-up CTF dipindah dari konstanta kode ke database agar Super Admin
-- bisa mengubah nominal tanpa deploy. Order lama tidak terpengaruh karena
-- PaymentOrder menyimpan snapshot packageName/amountIdr/ctfAmount.
CREATE TABLE "PaymentPackage" (
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amountIdr" INTEGER NOT NULL,
  "ctfAmount" INTEGER NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentPackage_pkey" PRIMARY KEY ("code")
);

CREATE INDEX "PaymentPackage_isActive_sortOrder_idx"
  ON "PaymentPackage"("isActive", "sortOrder");

-- Paket bawaan v1 (sama persis dengan PAYMENT_PACKAGES di
-- src/constants/payments.ts) supaya deployment langsung punya katalog.
INSERT INTO "PaymentPackage"
  ("code", "name", "amountIdr", "ctfAmount", "description", "sortOrder", "isActive", "updatedAt")
VALUES
  ('coba_dulu', 'Coba Dulu', 5000, 25, 'Paket kecil untuk mencoba top-up dan publish.', 10, true, CURRENT_TIMESTAMP),
  ('hemat', 'Hemat', 10000, 55, 'Bonus 5 CTF dibanding paket Coba Dulu.', 20, true, CURRENT_TIMESTAMP),
  ('mahasiswa', 'Mahasiswa', 25000, 145, 'Paling pas untuk pemakaian harian.', 30, true, CURRENT_TIMESTAMP),
  ('kampus', 'Kampus', 50000, 300, 'Untuk base dan komunitas yang aktif.', 40, true, CURRENT_TIMESTAMP),
  ('bundling', 'Bundling', 100000, 625, 'Paket terbesar dengan CTF per rupiah paling efisien.', 50, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;