-- Jalur manual/idempoten untuk tabel `Template` (produksi).
--
-- Normalnya TIDAK dipakai: cukup `npx prisma migrate deploy` karena
-- `20261028000000_template_model` adalah satu-satunya migrasi yang belum
-- diterapkan di produksi (dicek dengan `npx prisma migrate status`, 28 Okt 2026).
--
-- File ini disediakan bila `migrate deploy` tidak bisa dijalankan (mis. akses
-- shell ke DB produksi dibatasi). Isinya sengaja idempoten (`IF NOT EXISTS`),
-- jadi aman dijalankan ulang. Jangan pindahkan file ini ke `prisma/migrations/`:
-- Prisma akan menghitung checksum berbeda dan menganggap migrasi baru.
--
-- Setelah SQL ini sukses, catat migrasinya agar `migrate deploy` berikutnya
-- tidak mencoba membuat tabel lagi:
--   npx prisma migrate resolve --applied 20261028000000_template_model

CREATE TABLE IF NOT EXISTS "Template" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'campus',
    "renderer" TEXT NOT NULL DEFAULT 'svg',
    "aspect" TEXT NOT NULL DEFAULT 'portrait',
    "width" INTEGER NOT NULL DEFAULT 1080,
    "height" INTEGER NOT NULL DEFAULT 1350,
    "svgSource" TEXT NOT NULL,
    "slots" JSONB NOT NULL,
    "palette" JSONB,
    "thumbnailUrl" TEXT,
    "checksum" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Template_key_key" ON "Template"("key");
CREATE INDEX IF NOT EXISTS "Template_status_sortOrder_idx" ON "Template"("status", "sortOrder");
