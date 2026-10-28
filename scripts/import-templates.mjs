#!/usr/bin/env node
/**
 * import-templates.mjs — masukkan 12 desain SVG ke tabel `Template`.
 *
 * Geometri TIDAK ditulis manual di sini: semuanya berasal dari
 * `scripts/measure-templates.mjs` (pengukur yang sama yang dipakai
 * `verify-geometry.mjs`). Script ini hanya:
 *
 *   1. menormalkan SVG agar aman dirender resvg (`normalizeSvg`),
 *   2. mengukur slot (anchor, message, quote, user, time, footer),
 *   3. menurunkan label & palette dari isi SVG,
 *   4. `upsert` per `key` (nama file tanpa ekstensi).
 *
 * Idempoten: jalankan ulang kapan pun file SVG berubah. `checksum` mencatat
 * sha256 SVG ternormalisasi supaya drift bisa dideteksi tanpa menulis ulang.
 *
 * Pemakaian:
 *   npm run template:import:dev                  # tulis ke DB .env.development
 *   npm run template:import                      # tulis ke DB .env (produksi; butuh persetujuan)
 *   node scripts/import-templates.mjs --dry-run  # lihat hasil tanpa menyentuh DB
 *   node scripts/import-templates.mjs --dir assets/templates --only 01-helpdesk-ticket
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  BACKEND_ROOT,
  attr,
  measureTemplate,
  normalizeSvg,
  stripDefs,
} from './measure-templates.mjs';

/* ── Metadata tampilan (copy, bukan geometri) ────────────────────────────── */

/**
 * Label & deskripsi hanya untuk UI pemilih template. Default-nya diturunkan dari
 * nama file; entri di sini menimpa bila penulisan otomatis terbaca janggal
 * (mis. akronim seperti OMR/ID yang harus kapital).
 */
const DISPLAY = {
  '01-helpdesk-ticket': { label: 'Helpdesk Ticket', description: 'Tiket layanan kampus dengan panel pesan besar.', category: 'classic' },
  '02-network-map': { label: 'Network Map', description: 'Peta jaringan kampus dengan balon pesan.', category: 'classic' },
  '03-exam-omr': { label: 'Exam OMR', description: 'Lembar jawaban OMR dengan pesan di kolom kanan.', category: 'campus' },
  '04-sticky-note': { label: 'Sticky Note', description: 'Catatan tempel miring dengan pita perekat.', category: 'playful' },
  '05-campus-catalog': { label: 'Campus Catalog', description: 'Kartu katalog perpustakaan dengan cap OPEN.', category: 'classic' },
  '06-noticeboard': { label: 'Noticeboard', description: 'Papan pengumuman kampus dengan paku kayu.', category: 'classic' },
  '07-student-id': { label: 'Student ID', description: 'Kartu identitas mahasiswa dengan pita nama.', category: 'campus' },
  '08-services-file': { label: 'Services File', description: 'Berkas layanan mahasiswa dengan klip kertas.', category: 'campus' },
  '09-campus-daily': { label: 'Campus Daily', description: 'Koran kampus dengan kolom headline.', category: 'editorial' },
  '10-campus-transit': { label: 'Campus Transit', description: 'Tiket bus kampus dengan kode halte.', category: 'campus' },
  '11-cassette-mixtape': { label: 'Cassette Mixtape', description: 'Kaset mixtape dengan label tulisan tangan.', category: 'playful' },
  '12-lab-report': { label: 'Lab Report', description: 'Laporan laboratorium dengan jam pasir.', category: 'editorial' },
};

const titleCase = (key) =>
  key
    .replace(/^\d+-/, '')
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

/* ── Palette dari isi SVG ────────────────────────────────────────────────── */

const luminance = (hex) => {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * Warna dominan untuk UI pemilih template. Dihitung dari atribut `fill`
 * (bukan hardcoded), supaya template baru otomatis dapat warna yang benar.
 */
export function derivePalette(svg) {
  const counts = new Map();
  for (const m of stripDefs(svg).matchAll(/fill="#([0-9a-fA-F]{6})"/g)) {
    const hex = `#${m[1].toUpperCase()}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  const light = ordered.filter((hex) => luminance(hex) > 0.78);
  const dark = ordered.filter((hex) => luminance(hex) < 0.35);
  const accent = ordered.find(
    (hex) => luminance(hex) > 0.2 && luminance(hex) < 0.78 && !light.includes(hex)
  );
  return {
    bg: light[0] ?? '#FFFFFF',
    ink: dark[0] ?? '#111111',
    accent: accent ?? dark[0] ?? '#111111',
  };
}

/* ── Main ────────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(name);

const dir = path.resolve(BACKEND_ROOT, arg('--dir', 'assets/templates'));
const only = arg('--only', null);
const dryRun = has('--dry-run');

if (!fs.existsSync(dir)) {
  console.error(`Folder tidak ditemukan: ${dir}`);
  process.exit(1);
}

const files = fs
  .readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith('.svg'))
  .filter((f) => !only || path.basename(f, '.svg') === only)
  .sort();

if (!files.length) {
  console.error(`Tidak ada SVG di ${dir}${only ? ` (filter: ${only})` : ''}`);
  process.exit(1);
}

const rows = [];
const failed = [];

for (const file of files) {
  const full = path.join(dir, file);
  const raw = fs.readFileSync(full, 'utf8');
  const svg = normalizeSvg(raw);
  const t = measureTemplate(full);
  if (t.error) {
    failed.push({ file, error: t.error });
    continue;
  }

  const meta = DISPLAY[t.key] ?? {};
  rows.push({
    key: t.key,
    label: meta.label ?? titleCase(t.key),
    description: meta.description ?? null,
    category: meta.category ?? 'campus',
    renderer: 'svg',
    aspect: 'portrait',
    width: t.canvas.width,
    height: t.canvas.height,
    svgSource: svg,
    slots: {
      anchor: t.anchor,
      message: t.message,
      quote: t.quote,
      user: t.user,
      time: t.time,
      meta: t.meta,
      footer: t.footer,
      obstacles: t.obstacles,
      flagged: t.flags,
    },
    palette: derivePalette(svg),
    checksum: crypto.createHash('sha256').update(svg).digest('hex'),
    sortOrder: Number.parseInt(t.key.slice(0, 2), 10) || 0,
  });
}

console.log(`\n${rows.length} template siap diimpor dari ${path.relative(BACKEND_ROOT, dir)}\n`);
console.log(
  ['template', 'label', 'fs', 'maxW', 'maxLn', 'qMax', 'q1st', 'accent', 'flags'].map((s, i) =>
    s.padEnd([22, 20, 4, 6, 6, 6, 6, 9, 0][i])
  ).join('')
);
for (const r of rows) {
  const m = r.slots.message;
  const q = r.slots.quote ?? {};
  console.log(
    [
      r.key.padEnd(22),
      r.label.padEnd(20),
      String(m.fontSize).padEnd(4),
      String(m.maxWidth).padEnd(6),
      String(m.maxLines).padEnd(6),
      String(q.maxLines ?? '-').padEnd(6),
      String(q.firstCap ?? '-').padEnd(6),
      r.palette.accent.padEnd(9),
      r.slots.flagged.join(' | '),
    ].join('')
  );
}

if (failed.length) {
  console.error('\nGagal diukur:');
  for (const f of failed) console.error(`  ${f.file}: ${f.error}`);
}

if (dryRun) {
  console.log('\n--dry-run: tidak ada perubahan pada database.');
  process.exit(failed.length ? 1 : 0);
}

if (failed.length) {
  console.error('\nDibatalkan: perbaiki SVG yang gagal diukur dulu.');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  for (const row of rows) {
    const existing = await prisma.template.findUnique({ where: { key: row.key } });
    if (existing && existing.checksum === row.checksum) {
      console.log(`  = ${row.key} (tidak berubah)`);
      continue;
    }
    await prisma.template.upsert({
      where: { key: row.key },
      create: row,
      update: { ...row, version: (existing?.version ?? 1) + 1 },
    });
    console.log(`  ${existing ? '~' : '+'} ${row.key} v${(existing?.version ?? 1) + (existing ? 1 : 0)}`);
  }
  console.log('\nSelesai.');
} finally {
  await prisma.$disconnect();
}