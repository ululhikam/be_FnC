-- Mode gateway pembayaran Midtrans: Core API (default lama) atau Snap.
-- Disimpan sebagai snapshot per order agar order yang dibuat sebelum mode
-- diubah tetap dirender dengan flow yang benar.
ALTER TABLE "PaymentOrder"
  ADD COLUMN "gatewayMode" TEXT,
  ADD COLUMN "snapToken" TEXT,
  ADD COLUMN "snapRedirectUrl" TEXT;
