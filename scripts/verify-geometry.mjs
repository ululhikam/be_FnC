#!/usr/bin/env node
/**
 * verify-geometry.mjs — bukti visual bahwa geometri hasil `measure-templates.mjs`
 * memang pas. Untuk setiap template:
 *
 *   halaman 1 → `firstCap` baris isi fess + kotak kutipan di posisi terukur
 *   halaman 2 → `maxLines` baris isi fess (tanpa kutipan)
 *
 * Hasil PNG ditulis ke `docs/geometry-check/`. Kalau ada teks yang menembus
 * panel/pembatas/kotak kutipan, angkanya salah dan harus diperbaiki di pengukur.
 *
 * Pemakaian:
 *   node scripts/verify-geometry.mjs --dir ../template-card --out docs/geometry-check
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { measureDir, measureTemplate, textWidth, normalizeSvg, BACKEND_ROOT } from './measure-templates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SAMPLE =
  'Jadi ceritanya tadi pagi aku ketemu seseorang di lift gedung fakultas, ' +
  'dia bawa dua gelas kopi dan salah satunya dia kasih ke aku tanpa bilang apa-apa. ' +
  'Aku cuma bisa bilang makasih sambil deg-degan sampai lantai lima. ' +
  'Kalau kamu yang itu, boleh kenalan lagi besok di jam yang sama?';

const QUOTE =
  'kalian yang di lift tadi pagi, aku yang bawa kopi dua gelas itu hehe. ' +
  'besok aku bawa lagi ya, jangan kabur.';

const escapeXml = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** Bungkus teks per kata memakai lebar glif sebenarnya (opentype). */
function wrap(text, maxWidth, fontSize, letterSpacing) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    const width = textWidth(candidate, fontSize, letterSpacing) ?? 0;
    if (width <= maxWidth || !line) line = candidate;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  return out;
}

function fontFiles() {
  const dir = path.join(BACKEND_ROOT, 'fonts');
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.ttf'))
    .map((f) => path.join(dir, f));
}

/** Bersihkan hal yang tidak didukung resvg (font @import + blend mode). */
function normalize(svg) {
  return normalizeSvg(svg);
}

function render(svg, file) {
  const resvg = new Resvg(svg, {
    font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: 'Poppins' },
  });
  fs.writeFileSync(file, resvg.render().asPng());
}

/** Ganti isi #editable-message dengan `lines` baris teks baru (koordinat lokal). */
function replaceMessage(body, m, lines, color) {
  const open = /<g id="editable-message"([^>]*)>/.exec(body);
  const start = open.index;
  const inner = body.slice(start + open[0].length);
  const end = start + open[0].length + inner.indexOf('</g>') + 4;

  const texts = lines
    .map(
      (t, i) =>
        `    <text x="0" y="${i * m.lineHeight}" font-family="Poppins" font-size="${m.fontSize}" ` +
        `font-weight="${m.weight}" letter-spacing="${m.letterSpacing}" fill="${color}">${escapeXml(t)}</text>`
    )
    .join('\n');

  // Tag pembuka dipertahankan supaya transform (rotasi kartu) tidak hilang.
  const replacement = `${open[0]}\n${texts}\n  </g>`;

  return body.slice(0, start) + replacement + body.slice(end);
}

/** Kotak kutipan sesuai `slots.quote` hasil ukur (koordinat lokal anchor). */
function quoteBox(q, anchor) {
  const lines = wrap(QUOTE, q.width - q.padq * 2, q.fontSize, 0).slice(0, q.maxLines);
  const headerY = q.y + q.padq + Math.round(q.fontSize * 0.95);
  const firstY = q.y + q.padq + q.header + Math.round(q.fontSize * 0.95);
  const body = lines
    .map(
      (t, i) =>
        `    <text x="${q.x + q.padq}" y="${firstY + i * q.lineHeight}" font-family="Poppins" ` +
        `font-size="${q.fontSize}" fill="#111111" opacity=".72">${escapeXml(t)}</text>`
    )
    .join('\n');

  return `  <g id="check-quote" transform="matrix(${anchor.matrix.join(' ')})">
    <rect x="${q.x}" y="${q.y}" width="${q.width}" height="${q.height}" rx="${Math.round(q.padq * 0.9)}"
          fill="rgba(20,36,93,0.06)" stroke="#FF5A26" stroke-width="2"/>
    <text x="${q.x + q.padq}" y="${headerY}" font-family="Poppins" font-size="${q.fontSize}"
          font-weight="700" fill="#FF5A26">KUTIPAN</text>
${body}
  </g>`;
}

/* ── Main ────────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};

const dir = path.resolve(BACKEND_ROOT, getArg('--dir', 'assets/templates'));
const outDir = path.resolve(BACKEND_ROOT, getArg('--out', 'docs/geometry-check'));
fs.mkdirSync(outDir, { recursive: true });

const files = fs
  .readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith('.svg'))
  .sort();

for (const file of files) {
  const full = path.join(dir, file);
  const t = measureTemplate(full);
  if (t.error) {
    console.error(`${file}: ${t.error}`);
    continue;
  }

  const m = t.message;
  const q = t.quote;
  const color = m.fill || '#111111';
  const raw = normalize(fs.readFileSync(full, 'utf8'));
  const key = path.basename(file, '.svg');

  // Halaman 1: firstCap baris + kutipan.
  const page1Lines = wrap(SAMPLE, m.maxWidth, m.fontSize, m.letterSpacing).slice(0, q.firstCap);
  let svg1 = replaceMessage(raw, m, page1Lines, color);
  svg1 = svg1.replace('</svg>', `${quoteBox(q, t.anchor)}\n</svg>`);
  render(svg1, path.join(outDir, `${key}-p1.png`));

  // Halaman 2: kapasitas penuh tanpa kutipan.
  const page2Lines = wrap(SAMPLE, m.maxWidth, m.fontSize, m.letterSpacing).slice(0, m.maxLines);
  const svg2 = replaceMessage(raw, m, page2Lines, color);
  render(svg2, path.join(outDir, `${key}-p2.png`));

  console.log(
    `${key.padEnd(22)} p1=${String(page1Lines.length).padStart(2)}/${q.firstCap} ` +
      `p2=${String(page2Lines.length).padStart(2)}/${m.maxLines} ` +
      `q=${q.fontSize}px/${q.maxLines}ln`
  );
}

console.log(`\nPNG: ${outDir}`);
