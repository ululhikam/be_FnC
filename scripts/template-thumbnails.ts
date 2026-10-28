/**
 * template-thumbnails.ts — render & unggah thumbnail 12 template kartu.
 *
 * Sumber geometri tetap `assets/templates/*.svg` yang diukur dengan
 * `scripts/measure-templates.mjs` (fungsi yang sama dengan import DB), jadi
 * thumbnail tidak memakai angka desain yang ditulis ulang. Render memakai
 * `CanvasService` yang sama dengan auto-post, lalu PNG diperkecil agar pemilih
 * template tetap ringan.
 *
 * Path storage deterministik: `templates/<key>-v<version>.png` (upsert).
 * `version` dibaca dari tabel `Template` bila DB tersedia; `--no-db` memakai
 * versi 1 (dipakai sebelum tabel/baris ada di produksi).
 *
 * Pemakaian:
 *   npm run template:thumbnails:dev -- --host fessncurious-dev.vercel.app
 *   npm run template:thumbnails:prod -- --host fessncurious.vercel.app --no-db
 *   npm run template:thumbnails:dev -- --dry-run --out tmp/thumbs
 *   npm run template:thumbnails:dev -- --only 01-helpdesk-ticket --dry-run
 *
 * Opsi:
 *   --env dev|prod   dev = .env.development (default), prod = .env produksi
 *   --only <key>     satu atau beberapa key dipisah koma
 *   --host <host>    override host footer (default host FRONTEND_URL)
 *   --width <px>     lebar PNG thumbnail (default 540; tinggi ikut 4:5)
 *   --out <dir>      simpan PNG lokal untuk inspeksi
 *   --no-db          jangan baca/tulis tabel Template (hanya unggah storage)
 *   --dry-run        render saja, tanpa upload & tanpa tulis DB
 *   --no-quote       thumbnail tanpa kotak kutipan contoh
 *   --confirm-prod   wajib bila menulis thumbnailUrl ke DB produksi
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { BACKEND_ROOT, measureTemplate, normalizeSvg } from './measure-templates.mjs';
import { DISPLAY, derivePalette, titleCase } from './template-meta.mjs';
import type { TemplateRecord } from '../src/services/template.service.js';

const argv = process.argv.slice(2);
const has = (name: string) => argv.includes(name);
const arg = (name: string, fallback = '') => {
  const i = argv.indexOf(name);
  const next = i >= 0 ? argv[i + 1] : '';
  return next && !next.startsWith('--') ? next : fallback;
};

const envName = arg('--env', 'dev').toLowerCase();
const isProd = envName === 'prod' || envName === 'production';
if (!isProd && envName !== 'dev' && envName !== 'development') {
  console.error(`--env tidak dikenal: ${envName} (pakai dev|prod)`);
  process.exit(1);
}

/* ── Muat environment SEBELUM modul src (env.ts membaca .env sendiri) ────── */

if (isProd) {
  process.env.NODE_ENV = 'production';
  dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });
} else {
  process.env.NODE_ENV = 'development';
  dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });
  const devEnvPath = path.join(BACKEND_ROOT, '.env.development');
  if (!fs.existsSync(devEnvPath)) {
    console.error('backend/.env.development tidak ditemukan; tidak bisa memakai --env dev.');
    process.exit(1);
  }
  dotenv.config({ path: devEnvPath, override: true });
}

const only = new Set(
  arg('--only', '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)
);
const dir = path.resolve(BACKEND_ROOT, arg('--dir', 'assets/templates'));
const noDb = has('--no-db');
const dryRun = has('--dry-run');
const withQuote = !has('--no-quote');
const width = Math.min(1080, Math.max(200, Number.parseInt(arg('--width', '540'), 10) || 540));
const outDir = arg('--out', '');

if (isProd && !noDb && !has('--confirm-prod')) {
  console.error(
    'Menulis thumbnailUrl ke DB produksi butuh --confirm-prod.\n' +
      'Untuk unggah storage saja (sebelum migrasi/import), tambahkan --no-db.'
  );
  process.exit(1);
}

if (!fs.existsSync(dir)) {
  console.error(`Folder template tidak ditemukan: ${dir}`);
  process.exit(1);
}

/* ── Modul aplikasi dimuat setelah env siap ─────────────────────────────── */

const { ENV } = await import('../src/config/env.js');
const { CanvasService } = await import('../src/services/canvas.service.js');
const { StorageService } = await import('../src/services/storage.service.js');

let prisma: import('@prisma/client').PrismaClient | null = null;
try {
  if (!noDb) {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
    // Gagal cepat bila tabel belum dimigrasikan (produksi sebelum go-live).
    await prisma.$queryRaw`SELECT 1 FROM "Template" LIMIT 1`;
  }
} catch (err: any) {
  console.error(
    `Tabel "Template" belum bisa dibaca (${err?.message || err}).\n` +
      'Jalankan migrasi + import dulu, atau pakai --no-db untuk hanya mengunggah PNG.'
  );
  await prisma?.$disconnect();
  process.exit(1);
}

const defaultHost = (() => {
  try {
    return new URL(ENV.FRONTEND_URL).host;
  } catch {
    return ENV.FRONTEND_URL;
  }
})();
const footerHost = arg('--host', defaultHost) || defaultHost;

function describeDatabase(): string {
  if (!prisma) return 'dilewati (--no-db)';
  try {
    const url = new URL(ENV.DATABASE_URL);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return 'DATABASE_URL terpasang';
  }
}

async function main(): Promise<void> {
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.toLowerCase().endsWith('.svg'))
    .filter((file) => !only.size || only.has(path.basename(file, '.svg')))
    .sort();

  if (!files.length) {
    console.error(`Tidak ada SVG yang cocok di ${dir}.`);
    process.exit(1);
  }

  const keys = files.map((file) => path.basename(file, '.svg'));
  const missingFilter = [...only].filter((key) => !keys.includes(key));
  if (missingFilter.length) {
    console.error(`Key tidak ditemukan: ${missingFilter.join(', ')}`);
    process.exit(1);
  }

  const versions = new Map<string, number>();
  if (prisma) {
    const rows = await prisma.template.findMany({
      where: { key: { in: keys } },
      select: { key: true, version: true },
    });
    for (const row of rows) versions.set(row.key, row.version);
    const missing = keys.filter((key) => !versions.has(key));
    if (missing.length) {
      console.error(
        `Template belum ada di DB: ${missing.join(', ')}.\n` +
          'Jalankan `npm run template:import` dulu, atau pakai --no-db.'
      );
      process.exit(1);
    }
  }

  console.log(`\nEnvironment : ${isProd ? 'produksi' : 'dev'} (NODE_ENV=${ENV.NODE_ENV})`);
  console.log(`Database    : ${describeDatabase()}`);
  console.log(`Storage     : ${ENV.SUPABASE_URL} / ${ENV.SUPABASE_BUCKET}`);
  console.log(`Footer host : ${footerHost}`);
  console.log(`Ukuran PNG  : ${width}px (4:5)${withQuote ? '' : ', tanpa kutipan'}`);
  console.log(`Mode        : ${dryRun ? 'dry-run' : noDb ? 'upload saja (--no-db)' : 'upload + tulis DB'}`);

  if (outDir) {
    fs.mkdirSync(path.resolve(BACKEND_ROOT, outDir), { recursive: true });
    console.log(`Simpan lokal: ${path.resolve(BACKEND_ROOT, outDir)}`);
  }
  console.log('');

  let uploaded = 0;
  let totalBytes = 0;

  for (const file of files) {
    const full = path.join(dir, file);
    const measured = measureTemplate(full);
    if (measured.error) {
      console.error(`  ! ${file}: ${measured.error}`);
      process.exitCode = 1;
      continue;
    }

    const meta = DISPLAY[measured.key] ?? {};
    const version = versions.get(measured.key) ?? 1;
    const normalized = normalizeSvg(fs.readFileSync(full, 'utf8'));
    const record: TemplateRecord = {
      key: measured.key,
      label: meta.label ?? titleCase(measured.key),
      description: meta.description ?? null,
      category: meta.category ?? 'campus',
      renderer: 'svg',
      aspect: 'portrait',
      width: measured.canvas.width,
      height: measured.canvas.height,
      svgSource: normalized,
      slots: {
        anchor: measured.anchor,
        message: measured.message,
        quote: measured.quote,
        user: measured.user,
        time: measured.time,
        meta: measured.meta,
        footer: measured.footer,
        obstacles: measured.obstacles,
        flagged: measured.flags,
      },
      palette: derivePalette(normalized),
      thumbnailUrl: null,
      version,
      status: 'active',
      sortOrder: Number.parseInt(measured.key.slice(0, 2), 10) || 0,
    };

    const fullPng = CanvasService.renderTemplateThumbnail(record, {
      frontendHost: footerHost,
      withQuote,
    });
    const png = await sharp(fullPng)
      .resize({ width, withoutEnlargement: true })
      .png({ palette: true, quality: 90, compressionLevel: 9 })
      .toBuffer();
    totalBytes += png.length;

    if (outDir) {
      fs.writeFileSync(path.resolve(BACKEND_ROOT, outDir, `${measured.key}.png`), png);
    }

    const storagePath = `templates/${measured.key}-v${version}.png`;
    if (dryRun) {
      console.log(`  = ${measured.key} ${png.length.toLocaleString('id-ID')} B (${storagePath})`);
      continue;
    }

    const result = await StorageService.uploadBuffer({
      path: storagePath,
      buffer: png,
      contentType: 'image/png',
    });

    if (prisma) {
      await prisma.template.update({
        where: { key: measured.key },
        data: { thumbnailUrl: result.url },
      });
    }

    uploaded += 1;
    console.log(
      `  ${dryRun ? '=' : '+'} ${measured.key} v${version} ` +
        `${Math.round(png.length / 1024)} KB -> ${result.url}`
    );
  }

  console.log(
    `\nSelesai: ${dryRun ? 'dry-run, tidak ada perubahan' : `${uploaded} thumbnail diunggah`}` +
      `, total ${Math.round(totalBytes / 1024)} KB.`
  );
}

try {
  await main();
} finally {
  await prisma?.$disconnect();
}
