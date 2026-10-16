/**
 * Generator aset emoji: mengubah semua file SVG dari paket `@twemoji/svg`
 * (node_modules, terpasang sebagai devDependency) menjadi satu file JSON
 * `assets/emoji-paths.json` yang di-commit ke repo dan ikut ter-deploy
 * (lihat includeFiles di vercel.json).
 *
 * Struktur JSON: { "1f62d": "<path .../>", "2764-fe0f": "...", ... }
 * Kunci = nama file Twemoji (kode poin tanpa prefix `u+`, dipisah `-`).
 *
 * Jalankan: node scripts/gen-emoji-assets.mjs
 *
 * Lisensi aset: Twemoji © Twitter/X — CC-BY 4.0 (https://github.com/jdecked/twemoji).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'node_modules', '@twemoji', 'svg');

if (!fs.existsSync(srcDir)) {
  console.error('Folder @twemoji/svg tidak ditemukan. Jalankan: npm i -D @twemoji/svg');
  process.exit(1);
}

const map = {};
let skipped = 0;
for (const file of fs.readdirSync(srcDir)) {
  if (!file.endsWith('.svg')) continue;
  const raw = fs.readFileSync(path.join(srcDir, file), 'utf8');
  const openEnd = raw.indexOf('>', raw.indexOf('<svg'));
  const closeStart = raw.lastIndexOf('</svg>');
  if (openEnd < 0 || closeStart < 0) {
    skipped++;
    continue;
  }
  const inner = raw
    .slice(openEnd + 1, closeStart)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!inner) {
    skipped++;
    continue;
  }
  map[file.replace(/\.svg$/, '')] = inner;
}

const outDir = path.join(root, 'assets');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'emoji-paths.json');
fs.writeFileSync(outFile, JSON.stringify(map));

const size = fs.statSync(outFile).size;
console.log(`[emoji-assets] ${Object.keys(map).length} emoji ditulis ke assets/emoji-paths.json (${(size / 1024 / 1024).toFixed(2)} MB), dilewati: ${skipped}`);

// Spot-check beberapa sekuens penting
for (const key of ['1f62d', '2764-fe0f', '1f1ee-1f1e9', '1f44d-1f3fd', '1f9d1-200d-1f4bb', '1fae0', '1fa77']) {
  console.log(`  ${key}: ${map[key] ? 'OK' : 'TIDAK ADA'}`);
}
