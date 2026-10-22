-- Waktu terakhir handle pengguna diubah, untuk cooldown 7 hari.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "handleChangedAt" TIMESTAMP(3);
