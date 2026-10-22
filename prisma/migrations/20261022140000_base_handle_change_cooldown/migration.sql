-- Waktu terakhir handle base diubah, untuk cooldown 7 hari.
ALTER TABLE "Base"
  ADD COLUMN IF NOT EXISTS "handleChangedAt" TIMESTAMP(3);
