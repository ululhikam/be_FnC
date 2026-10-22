-- Simpan fess favorit per user (bookmark).
CREATE TABLE IF NOT EXISTS "Bookmark" (
  "id" TEXT NOT NULL,
  "fessId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Bookmark_fessId_userId_key"
  ON "Bookmark"("fessId", "userId");

CREATE INDEX IF NOT EXISTS "Bookmark_userId_createdAt_idx"
  ON "Bookmark"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "Bookmark_fessId_idx"
  ON "Bookmark"("fessId");

DO $$
BEGIN
  ALTER TABLE "Bookmark"
    ADD CONSTRAINT "Bookmark_fessId_fkey"
    FOREIGN KEY ("fessId") REFERENCES "Fess"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Bookmark"
    ADD CONSTRAINT "Bookmark_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ID media Instagram yang dipublikasikan, untuk menghapus postingan saat take down.
ALTER TABLE "Fess"
  ADD COLUMN IF NOT EXISTS "igMediaId" TEXT;
