-- Template kartu berbasis SVG (12 desain template-card).
-- Geometri slot tidak di-hardcode di kode: kolom "slots" diisi oleh
-- scripts/import-templates.mjs yang mengukur langsung dari atribut SVG.
-- "svgSource" menyimpan SVG yang sudah dinormalisasi untuk resvg (tanpa @import
-- Google Fonts & mix-blend-mode), jadi yang dirender = yang tersimpan.
CREATE TABLE "Template" (
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

CREATE UNIQUE INDEX "Template_key_key" ON "Template"("key");
CREATE INDEX "Template_status_sortOrder_idx" ON "Template"("status", "sortOrder");