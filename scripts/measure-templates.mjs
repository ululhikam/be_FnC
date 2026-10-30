/**
 * measure-templates.mjs — menurunkan SELURUH geometri template dari file SVG-nya.
 *
 * Sengaja TANPA shebang `#!/usr/bin/env node`. Skrip ini bukan hanya dijalankan
 * langsung (`npm run template:measure` memakai `node ...mjs`, jadi shebang tidak
 * dibutuhkan), tetapi juga di-import dinamis oleh `src/utils/template-admin.util.ts`
 * saat Vitest berjalan — dan transformer Vitest/esbuild menolak file yang diawali
 * shebang dengan `SyntaxError: Invalid or unexpected token`, sehingga seluruh
 * `tests/template-admin.util.test.ts` gagal.
 *
 * Tidak ada angka per-template yang di-hardcode. Semua nilai (posisi, ukuran font,
 * line height, lebar kolom, batas bawah, kapasitas baris, font kutipan, dan
 * paginasi) dihitung dari atribut SVG sumber.
 *
 * Sumber sinyal:
 *   1. `<g id="editable-message">`   → x, y, font-size, font-weight, letter-spacing, fill
 *   2. jarak antar baris contoh      → line-height (median, bukan konstanta)
 *   3. rect terkecil yang memuat     → panel teks (batas kanan & bawah)
 *   4. garis horizontal struktural   → batas kolom & batas bawah yang lebih ketat
 *   5. blok padat di bawah teks      → mis. pill footer / kotak tanda tangan
 *   6. ornamen ber-transform         → area yang harus dihindari kotak kutipan
 *   7. lebar baris contoh (opentype) → validasi lebar kolom
 *
 * Semua geometri dihitung setelah `transform` grup induk diterapkan (translate,
 * rotate, scale, matrix), karena banyak ornamen diletakkan relatif di dalam grup.
 *
 * Dipakai oleh `scripts/import-templates.mjs` dan `scripts/verify-geometry.mjs`.
 *
 * Pemakaian:
 *   node scripts/measure-templates.mjs --dir ../template-card
 *   node scripts/measure-templates.mjs --dir ../template-card --json docs/template-geometry.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(__dirname, '..');

/* ── Konstanta renderer (satu-satunya angka tetap; sisanya turunan) ───────── */

/** Jarak aman baseline terakhir ↔ batas bawah / margin kanan. Sama dengan renderer lama. */
export const SAFE_PAD = 40;
/** Jarak aman teks ↔ kotak kutipan. */
export const QUOTE_GAP = 26;
/** Minimal baris isi fess di halaman 1 saat ada kutipan. */
export const MIN_FIRST_LINES = 3;
/** Maksimal baris kutipan. */
export const MAX_QUOTE_LINES = 4;
/** Lebar minimum kotak kutipan; di bawah ini lebih baik menabrak ornamen daripada tidak terbaca. */
export const MIN_QUOTE_WIDTH = 260;
/** Ornamen dianggap penghalang bila menutupi ≥ bagian ini dari tinggi kotak kutipan. */
const OBSTACLE_OVERLAP = 0.5;
/** ...dan minimal setinggi ini, supaya sentuhan kecil di tepi tidak dihitung. */
const OBSTACLE_MIN_OVERLAP = 40;

/**
 * Rasio metrik kutipan terhadap ukuran font kutipan.
 * Diturunkan dari buildQuoteBlock lama (font 29 → PADQ 18, HEADER 48, LH 40, FOOT 14),
 * supaya template tetap menghasilkan proporsi yang sama saat fontnya berbeda.
 */
export const QUOTE_METRICS = {
  padq: 18 / 29,
  header: 48 / 29,
  lineHeight: 40 / 29,
  foot: 14 / 29,
};

/** Ukuran font kutipan relatif terhadap font isi fess (29/46 dari renderer lama). */
export const QUOTE_FONT_RATIO = 29 / 46;

/** Faktor pengecilan kutipan bila area teks terlalu sempit. */
const SHRINK_STEPS = [1, 0.92, 0.85, 0.78];

/* ── Utilitas atribut ────────────────────────────────────────────────────── */

export const attr = (attrs, name) => {
  // `(?:^|\s)` wajib: tanpa itu `width` juga cocok dengan `stroke-width`.
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
};

export const num = (attrs, name, fallback = 0) => {
  const v = attr(attrs, name);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Buang <defs> agar isi <pattern>/<style> tidak jadi kandidat bentuk. */
export const stripDefs = (svg) =>
  svg.replace(/<defs[\s\S]*?<\/defs>/gi, '').replace(/<!--[\s\S]*?-->/g, '');

/**
 * Normalisasi SVG agar bisa dirender resvg di server — dipakai saat import ke DB,
 * jadi hasilnya satu-satunya versi yang disimpan & dirender.
 *
 * 1. `@import` Google Fonts dibuang: resvg tidak mengambil resource jaringan, dan
 *    font sudah disediakan lewat `fontFiles` (lihat `src/config/fonts.ts`).
 * 2. Font stack `var(--font-sans, 'Poppins', sans-serif)` diganti `'Poppins'`:
 *    usvg tidak menyelesaikan CSS custom property, sehingga teks bisa jatuh ke
 *    font default dan kehilangan bobot/letter-spacing.
 * 3. `mix-blend-mode` dibuang (tidak didukung, hanya membuat hasil beda antar-versi).
 *
 * Blok `<style>` TIDAK boleh dibuang seluruhnya: kelas `.display` memasok
 * `font-weight: 800` dan `letter-spacing`, yang tidak ada di atribut elemen.
 */
export function normalizeSvg(svg) {
  return svg
    .replace(/\s*@import[^;]*;/g, '')
    .replace(/var\(--font-(?:sans|display)\s*,\s*'Poppins'\s*,\s*sans-serif\)/g, "'Poppins'")
    .replace(/\s*style="[^"]*mix-blend-mode[^"]*"/gi, '');
}

/* ── Matriks transform ───────────────────────────────────────────────────── */

const IDENTITY = [1, 0, 0, 1, 0, 0];

/** Gabungkan dua matriks SVG: hasil = m1 × m2 (m2 diterapkan lebih dulu). */
export function mulMatrix(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function applyMatrix(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Invers matriks affine; null bila matriks singular. */
export function invertMatrix(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return null;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

const TRANSFORM_RE = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;

/** Parse atribut `transform` menjadi satu matriks. */
export function parseTransform(value) {
  if (!value) return IDENTITY;
  let m = IDENTITY;
  TRANSFORM_RE.lastIndex = 0;
  let hit;
  while ((hit = TRANSFORM_RE.exec(value)) !== null) {
    const args = hit[2]
      .split(/[\s,]+/)
      .filter((s) => s !== '')
      .map(Number);
    let t = IDENTITY;
    switch (hit[1]) {
      case 'translate':
        t = [1, 0, 0, 1, args[0] || 0, args[1] || 0];
        break;
      case 'scale':
        t = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const a = ((args[0] || 0) * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const cx = args[1] || 0;
        const cy = args[2] || 0;
        t = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((args[0] || 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((args[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
      case 'matrix':
        t = args.length >= 6 ? args.slice(0, 6) : IDENTITY;
        break;
      default:
        break;
    }
    m = mulMatrix(m, t);
  }
  return m;
}

/* ── Parser path → titik absolut ─────────────────────────────────────────── */

const ARG_COUNT = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/**
 * Ubah atribut `d` menjadi daftar subpath berisi titik (koordinat lokal).
 * Kurva diwakili titik kontrol + titik akhir; busur memakai titik akhir.
 * Cukup akurat untuk desain axis-aligned seperti kartu ini.
 */
export function pathSubpaths(d) {
  const tokens = String(d).match(/[a-zA-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
  const out = [];
  let cur = [];
  let i = 0;
  let cmd = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;

  const add = (x, y) => {
    cur.push({ x, y });
    cx = x;
    cy = y;
  };

  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd.toUpperCase() === 'Z') {
        cx = sx;
        cy = sy;
        continue;
      }
    }
    if (!cmd) {
      i += 1;
      continue;
    }
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    const n = ARG_COUNT[up];
    if (!n) {
      i += 1;
      continue;
    }
    if (i + n > tokens.length) break;

    const a = tokens.slice(i, i + n).map(Number);
    i += n;
    const ax = (k) => (rel ? cx + a[k] : a[k]);
    const ay = (k) => (rel ? cy + a[k] : a[k]);

    if (up === 'M') {
      if (cur.length) out.push(cur);
      cur = [];
      sx = ax(0);
      sy = ay(1);
      add(sx, sy);
      cmd = rel ? 'l' : 'L';
    } else if (up === 'L' || up === 'T') add(ax(0), ay(1));
    else if (up === 'H') add(ax(0), cy);
    else if (up === 'V') add(cx, ay(0));
    else if (up === 'C') {
      add(ax(0), ay(1));
      add(ax(2), ay(3));
      add(ax(4), ay(5));
    } else if (up === 'S' || up === 'Q') {
      add(ax(0), ay(1));
      add(ax(2), ay(3));
    } else if (up === 'A') add(ax(5), ay(6));
  }

  if (cur.length) out.push(cur);
  return out;
}

/* ── Pohon elemen SVG (transform-aware) ──────────────────────────────────── */

const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

/** Bangun pohon elemen sederhana; cukup untuk SVG yang dihasilkan desainer. */
export function parseSvg(body) {
  const root = { tag: 'root', attrs: '', children: [], parent: null, matrix: IDENTITY };
  let stack = [root];

  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(body)) !== null) {
    const [, closing, tag, attrs, selfClose] = m;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const parent = stack[stack.length - 1];
    const node = {
      tag,
      attrs,
      children: [],
      parent,
      matrix: mulMatrix(parent.matrix, parseTransform(attr(attrs, 'transform'))),
      index: m.index,
      content: '',
    };

    /* Isi teks dipakai untuk memvalidasi lebar kolom, jadi harus ikut diambil. */
    if (tag === 'text') {
      const open = body.indexOf('>', m.index) + 1;
      const close = body.indexOf('</text>', open);
      if (close > open) node.content = body.slice(open, close).replace(/<[^>]*>/g, '');
    }

    parent.children.push(node);
    if (!selfClose) stack.push(node);
  }

  return root;
}

/** Bounding box lokal sebuah bentuk (sebelum transform). */
function localBBox(node) {
  const a = node.attrs;
  switch (node.tag) {
    case 'rect': {
      const w = num(a, 'width');
      const h = num(a, 'height');
      if (!(w > 0 && h > 0)) return null;
      const x = num(a, 'x');
      const y = num(a, 'y');
      return { points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] };
    }
    case 'circle': {
      const cx = num(a, 'cx');
      const cy = num(a, 'cy');
      const r = num(a, 'r');
      if (!(r > 0)) return null;
      return { points: [{ x: cx - r, y: cy - r }, { x: cx + r, y: cy - r }, { x: cx + r, y: cy + r }, { x: cx - r, y: cy + r }] };
    }
    case 'ellipse': {
      const cx = num(a, 'cx');
      const cy = num(a, 'cy');
      const rx = num(a, 'rx');
      const ry = num(a, 'ry');
      if (!(rx > 0 && ry > 0)) return null;
      return { points: [{ x: cx - rx, y: cy - ry }, { x: cx + rx, y: cy - ry }, { x: cx + rx, y: cy + ry }, { x: cx - rx, y: cy + ry }] };
    }
    case 'line':
      return {
        points: [
          { x: num(a, 'x1'), y: num(a, 'y1') },
          { x: num(a, 'x2'), y: num(a, 'y2') },
        ],
      };
    case 'path': {
      const d = attr(a, 'd');
      if (!d) return null;
      const subpaths = pathSubpaths(d);
      if (!subpaths.length) return null;
      return { points: subpaths.flat(), subpaths };
    }
    case 'polygon':
    case 'polyline': {
      const raw = (attr(a, 'points') || '').trim();
      if (!raw) return null;
      const nums = raw.split(/[\s,]+/).map(Number);
      const points = [];
      for (let i = 0; i + 1 < nums.length; i += 2) points.push({ x: nums[i], y: nums[i + 1] });
      return points.length ? { points } : null;
    }
    default:
      return null;
  }
}

const bboxOfPoints = (points) => {
  if (!points.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const p of points) {
    if (p.x < x1) x1 = p.x;
    if (p.y < y1) y1 = p.y;
    if (p.x > x2) x2 = p.x;
    if (p.y > y2) y2 = p.y;
  }
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
};

/**
 * Semua bentuk daun dengan bbox, diukur di ruang `space`.
 * `space` = matriks tambahan yang diterapkan setelah transform tiap elemen;
 * dipakai untuk melepas rotasi seluruh kartu supaya geometri kembali axis-aligned.
 */
function collectShapes(root, space = IDENTITY) {
  const shapes = [];

  const walk = (node) => {
    const local = localBBox(node);
    if (local) {
      const matrix = mulMatrix(space, node.matrix);
      const abs = local.points.map((p) => applyMatrix(matrix, p.x, p.y));
      const bbox = bboxOfPoints(abs);

      /* Segmen horizontal hanya diambil dari elemen garis (path/line/polyline).
       * Rusuk atas/bawah sebuah rect bukan garis dekoratif — kalau ikut dihitung,
       * setiap kotak label akan terbaca sebagai pembatas kolom. */
      const isStroke = node.tag === 'path' || node.tag === 'line' || node.tag === 'polyline';
      const segments = isStroke
        ? (local.subpaths || [local.points])
            .map((sub) => sub.map((p) => applyMatrix(matrix, p.x, p.y)))
            .flatMap((pts) => {
              const out = [];
              for (let i = 1; i < pts.length; i += 1) {
                const p = pts[i - 1];
                const q = pts[i];
                if (Math.abs(p.y - q.y) <= 0.5 && Math.abs(q.x - p.x) >= 120) {
                  out.push({ y: p.y, x1: Math.min(p.x, q.x), x2: Math.max(p.x, q.x) });
                }
              }
              return out;
            })
        : [];

      if (bbox) shapes.push({ tag: node.tag, node, bbox, segments });
    }
    for (const child of node.children) walk(child);
  };

  for (const child of root.children) walk(child);
  return shapes;
}

/** Cari node pertama dengan atribut id tertentu. */
function findById(root, id) {
  let found = null;
  const walk = (node) => {
    if (found) return;
    if (attr(node.attrs, 'id') === id) {
      found = node;
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(root);
  return found;
}

/** Semua node <text> di dalam sebuah grup (langsung, bukan bersarang). */
function textChildren(group) {
  return group.children
    .filter((c) => c.tag === 'text')
    .map((c) => ({
      node: c,
      x: num(c.attrs, 'x'),
      y: num(c.attrs, 'y'),
      fontSize: num(c.attrs, 'font-size', 0),
      weight: num(c.attrs, 'font-weight', 400),
      fill: attr(c.attrs, 'fill'),
      anchor: attr(c.attrs, 'text-anchor') || 'start',
      content: c.content || '',
    }));
}

/* ── Pengukuran teks (opentype + font bundled) ───────────────────────────── */

let measureFont;

export function loadMeasureFont() {
  if (measureFont !== undefined) return measureFont;
  measureFont = null;
  for (const name of ['Poppins-Bold.ttf', 'Poppins-SemiBold.ttf', 'Poppins-Regular.ttf']) {
    const file = path.join(BACKEND_ROOT, 'fonts', name);
    if (!fs.existsSync(file)) continue;
    try {
      const buf = fs.readFileSync(file);
      measureFont = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      break;
    } catch {
      /* coba font berikutnya */
    }
  }
  return measureFont;
}

export function textWidth(text, fontSize, letterSpacing = 0) {
  const font = loadMeasureFont();
  if (!font) return null;
  const glyphs = font.stringToGlyphs(String(text));
  if (!glyphs.length) return 0;
  let w = 0;
  for (let i = 0; i < glyphs.length; i += 1) {
    w += glyphs[i].advanceWidth;
    if (i < glyphs.length - 1) w += font.getKerningValue(glyphs[i], glyphs[i + 1]);
  }
  return (w / font.unitsPerEm) * fontSize + letterSpacing * Math.max(0, glyphs.length - 1);
}

/* ── Geometri kutipan ────────────────────────────────────────────────────── */

/** Metrik kotak kutipan untuk satu ukuran font. */
export function quoteMetrics(fontSize) {
  const padq = Math.round(fontSize * QUOTE_METRICS.padq);
  const header = Math.round(fontSize * QUOTE_METRICS.header);
  const lineHeight = Math.round(fontSize * QUOTE_METRICS.lineHeight);
  const foot = Math.round(fontSize * QUOTE_METRICS.foot);
  const heightFor = (lines) => padq + header + lines * lineHeight + foot;
  return { padq, header, lineHeight, foot, heightFor };
}

/**
 * Tentukan geometri slot kutipan dari ruang yang tersedia.
 *
 * Aturan: pilih n terbesar (1..MAX_QUOTE_LINES) yang masih menyisakan
 * MIN_FIRST_LINES baris isi fess di halaman 1. Bila tidak ada, kecilkan font
 * kutipan bertahap. Bila pengecilan tetap tidak menambah baris isi fess, font
 * penuh dipakai dan n diambil terbesar yang masih menyisakan 2 baris isi fess.
 */
export function deriveQuote({ bottom, msgY, fontSize, lineHeight, width }) {
  const descender = fontSize * 0.25;
  const baseFont = Math.max(18, Math.round(fontSize * QUOTE_FONT_RATIO));

  const at = (quoteFont, lines) => {
    const m = quoteMetrics(quoteFont);
    const y = bottom - m.heightFor(lines);
    return {
      y,
      height: m.heightFor(lines),
      metrics: m,
      firstCap: Math.max(1, Math.floor((y - QUOTE_GAP - descender - msgY) / lineHeight) + 1),
    };
  };

  for (const factor of SHRINK_STEPS) {
    const quoteFont = Math.max(14, Math.round(baseFont * factor));
    let best = null;
    for (let n = 1; n <= MAX_QUOTE_LINES; n += 1) {
      const r = at(quoteFont, n);
      if (r.firstCap >= MIN_FIRST_LINES) best = { n, ...r };
    }
    if (best) {
      return {
        x: null, // diisi pemanggil (message.x)
        y: best.y,
        width,
        maxLines: best.n,
        fontSize: quoteFont,
        lineHeight: best.metrics.lineHeight,
        padq: best.metrics.padq,
        header: best.metrics.header,
        foot: best.metrics.foot,
        height: best.height,
        firstCap: best.firstCap,
        shrink: Number((quoteFont / baseFont).toFixed(3)),
      };
    }
  }

  const quoteFont = baseFont;
  let best = null;
  for (let n = 1; n <= MAX_QUOTE_LINES; n += 1) {
    const r = at(quoteFont, n);
    if (r.firstCap >= 2) best = { n, ...r };
  }
  const chosen = best || { n: 1, ...at(quoteFont, 1) };
  return {
    x: null,
    y: chosen.y,
    width,
    maxLines: chosen.n,
    fontSize: quoteFont,
    lineHeight: chosen.metrics.lineHeight,
    padq: chosen.metrics.padq,
    header: chosen.metrics.header,
    foot: chosen.metrics.foot,
    height: chosen.height,
    firstCap: chosen.firstCap,
    shrink: 1,
  };
}

/* ── Analisis satu template ──────────────────────────────────────────────── */

export function measureTemplate(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const svgTag = /<svg\b([^>]*)>/.exec(raw);
  const canvas = {
    width: num(svgTag ? svgTag[1] : '', 'width', 1080),
    height: num(svgTag ? svgTag[1] : '', 'height', 1350),
  };

  const body = stripDefs(raw);
  const root = parseSvg(body);
  const flags = [];

  /* 1. Grup pesan */
  const msgNode = findById(root, 'editable-message');
  if (!msgNode) return { file: path.basename(file), error: 'grup #editable-message tidak ada' };

  /* Beberapa kartu memiringkan seluruh isinya (mis. rotate(-1.4)). Semua
   * pengukuran dilakukan di ruang lokal grup pesan supaya geometri desain
   * kembali axis-aligned; rotasi disimpan sebagai matriks untuk renderer. */
  const toLocal = invertMatrix(msgNode.matrix) || IDENTITY;
  const shapes = collectShapes(root, toLocal);

  const msgX = 0;
  const msgY = 0;
  const letterSpacing = Number(attr(msgNode.attrs, 'letter-spacing') || 0);

  const exampleLines = textChildren(msgNode);
  if (!exampleLines.length) return { file: path.basename(file), error: '#editable-message tanpa <text>' };

  const fontSize = exampleLines[0].fontSize || 46;

  /* 2. Line height dari jarak baris contoh (median) */
  const deltas = exampleLines
    .slice(1)
    .map((l, i) => l.y - exampleLines[i].y)
    .sort((a, b) => a - b);
  const lineHeight = deltas.length ? deltas[Math.floor(deltas.length / 2)] : Math.round(fontSize * 1.37);

  /* 3. Panel teks = rect terkecil yang memuat anchor pesan */
  const panels = shapes
    .filter(
      (s) =>
        s.tag === 'rect' &&
        msgX > s.bbox.x1 &&
        msgX < s.bbox.x2 &&
        msgY > s.bbox.y1 &&
        msgY < s.bbox.y2
    )
    .map((s) => ({ ...s.bbox, area: s.bbox.w * s.bbox.h, shape: s }))
    .sort((a, b) => a.area - b.area);
  const panel = panels[0] || null;
  if (!panel) flags.push('panel-tidak-terdeteksi');

  /* 4. Garis horizontal struktural (setelah transform), lalu digabung bila sebaris */
  const rawLines = [];
  for (const s of shapes) {
    if (s.bbox.h <= 6 && s.bbox.w >= 120) rawLines.push({ y: (s.bbox.y1 + s.bbox.y2) / 2, x1: s.bbox.x1, x2: s.bbox.x2 });
    for (const seg of s.segments) rawLines.push(seg);
  }
  const lines = [];
  for (const l of rawLines.sort((a, b) => a.y - b.y)) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - l.y) <= 1) {
      last.x1 = Math.min(last.x1, l.x1);
      last.x2 = Math.max(last.x2, l.x2);
    } else {
      lines.push({ ...l });
    }
  }

  /* 5. Garis yang menutup blok teks dari bawah.
   * Hanya garis di bawah baris contoh terakhir yang dimulai dari/di kiri kolom
   * teks; garis header di atas teks dan garis dekorasi di margin diabaikan. */
  const exampleBottom = msgY + exampleLines[exampleLines.length - 1].y;
  const closingLines = lines
    .filter((l) => l.y > exampleBottom + 8 && l.x1 <= msgX + 8 && l.x2 >= msgX + 200)
    .sort((a, b) => a.y - b.y);

  /* 6. Batas kanan kolom: panel, atau garis penutup paling kiri. */
  let columnRight = panel ? panel.x2 : canvas.width;
  let widthSource = panel ? 'panel' : 'kanvas';
  for (const l of closingLines) {
    if (l.x2 < columnRight) {
      columnRight = l.x2;
      widthSource = 'garis-penutup';
    }
  }

  /* 7. Batas bawah area teks: yang paling ketat antara panel, garis penutup,
   * dan blok lebar di bawah teks (pill footer, kotak tanda tangan, dst).
   * Hanya blok yang menutupi ≥ 60% lebar kolom yang dihitung; ikon dan ornamen
   * kecil ditangani terpisah sebagai penghalang kotak kutipan, bukan batas teks. */
  const bottomCandidates = [];
  if (panel) bottomCandidates.push({ source: 'panel', y: panel.y2 });
  for (const l of closingLines) bottomCandidates.push({ source: 'garis', y: l.y });
  const columnSpan = columnRight - msgX;
  for (const s of shapes) {
    if (panel && s === panel.shape) continue;
    if (s.bbox.h <= 6 || s.bbox.h > 400) continue;
    if (s.bbox.y1 <= exampleBottom + 8) continue;
    if (s.bbox.x1 >= columnRight || s.bbox.x2 <= msgX) continue;
    if (panel && s.bbox.w * s.bbox.h >= panel.area) continue;
    const overlapW = Math.min(s.bbox.x2, columnRight) - Math.max(s.bbox.x1, msgX);
    if (overlapW < columnSpan * 0.6) continue;
    bottomCandidates.push({ source: 'blok', y: s.bbox.y1 });
  }
  const bottomEdge = bottomCandidates.length
    ? bottomCandidates.reduce((a, b) => (a.y <= b.y ? a : b))
    : null;
  if (!bottomEdge) flags.push('batas-bawah-tidak-terdeteksi');

  /* 8. Lebar kolom = batas kanan − margin kanan. Baris contoh desain sendiri
   * adalah bukti lebar minimum yang memang dipakai desain. */
  const widestExample = Math.max(
    ...exampleLines.map((l) => textWidth(l.content || '', l.fontSize, letterSpacing) ?? 0)
  );
  const columnWidth = columnRight - msgX;
  const maxWidth = Math.round(Math.max(columnWidth - SAFE_PAD, Math.min(widestExample, columnWidth)));
  if (widestExample > columnWidth) flags.push('contoh-melebihi-kolom');

  /* 9. Ornamen yang menembus kolom teks (cap stempel, ikon, jam pasir, dst).
   * Ini bukan garis dan bukan panel, tapi tidak boleh ditabrak teks. */
  const bottom = bottomEdge ? Math.round(bottomEdge.y - SAFE_PAD) : null;
  const obstacles = [];
  for (const s of shapes) {
    if (panel && s === panel.shape) continue;
    if (s.bbox.w >= canvas.width * 0.9 && s.bbox.h >= canvas.height * 0.9) continue; // latar
    if (s.bbox.h <= 6) continue; // garis
    if (bottom === null || s.bbox.y1 >= bottom) continue;
    if (s.bbox.y1 <= exampleBottom) continue;
    if (s.bbox.x2 <= msgX + 40) continue;
    if (s.bbox.x1 >= columnRight) continue;
    obstacles.push({
      x1: Math.round(s.bbox.x1),
      x2: Math.round(s.bbox.x2),
      y1: Math.round(s.bbox.y1),
      y2: Math.round(s.bbox.y2),
      tag: s.tag,
    });
  }

  /* 10. Kapasitas baris & geometri kutipan */
  const descender = fontSize * 0.25;
  const maxLines =
    bottom === null ? null : Math.max(1, Math.floor((bottom - msgY - descender) / lineHeight) + 1);

  let quote = null;
  if (bottom !== null && maxWidth) {
    quote = deriveQuote({ bottom, msgY, fontSize, lineHeight, width: maxWidth });
    quote.x = msgX;

    /* Kotak kutipan menghindari ornamen yang benar-benar menutupinya: ornamen
     * harus menutupi ≥ 50% tinggi kotak DAN minimal 40px, supaya ujung tiang
     * antena atau ornamen kecil di tepi bawah tidak membuat kotak mengecil. */
    const bandTop = quote.y;
    const bandBottom = quote.y + quote.height;
    let rightLimit = columnRight;
    let avoided = null;
    for (const o of obstacles) {
      const overlap = Math.min(o.y2, bandBottom) - Math.max(o.y1, bandTop);
      if (overlap < OBSTACLE_MIN_OVERLAP) continue;
      if (overlap / Math.min(o.y2 - o.y1, bandBottom - bandTop) < OBSTACLE_OVERLAP) continue;
      if (o.x1 <= msgX + 200) continue;
      if (o.x1 < rightLimit) {
        rightLimit = o.x1;
        avoided = o;
      }
    }
    if (avoided) {
      const narrowed = Math.round(rightLimit - msgX - SAFE_PAD);
      if (narrowed >= MIN_QUOTE_WIDTH) {
        quote.width = narrowed;
        quote.avoided = avoided;
        flags.push(`kutipan-menghindari-ornamen-${avoided.tag}`);
      } else {
        flags.push('ornamen-terlalu-dekat');
      }
    }

    if (quote.firstCap < MIN_FIRST_LINES) flags.push('kutipan-menyempit');
    if (quote.shrink < 1) flags.push(`kutipan-dikecilkan-${quote.shrink}`);
  }

  /* 11. Slot teks lain */
  const slotOf = (id) => {
    const node = findById(root, id);
    if (!node || node.tag !== 'text') return null;
    return {
      x: node.matrix[4] + num(node.attrs, 'x'),
      y: node.matrix[5] + num(node.attrs, 'y'),
      fontSize: num(node.attrs, 'font-size', 0),
      weight: num(node.attrs, 'font-weight', 400),
      fill: attr(node.attrs, 'fill'),
      anchor: attr(node.attrs, 'text-anchor') || 'start',
    };
  };

  const metaNode = findById(root, 'editable-meta');
  let meta = null;
  if (metaNode) {
    const texts = textChildren(metaNode);
    if (texts.length >= 2) {
      meta = {
        handle: {
          x: metaNode.matrix[4] + texts[0].x,
          y: metaNode.matrix[5] + texts[0].y,
          fontSize: texts[0].fontSize,
          weight: texts[0].weight,
          fill: texts[0].fill,
          anchor: texts[0].anchor,
        },
        time: {
          x: metaNode.matrix[4] + texts[1].x,
          y: metaNode.matrix[5] + texts[1].y,
          fontSize: texts[1].fontSize,
          weight: texts[1].weight,
          fill: texts[1].fill,
          anchor: texts[1].anchor,
        },
      };
    }
  }

  return {
    key: path.basename(file, '.svg'),
    file: path.basename(file),
    canvas,
    /* Posisi grup #editable-message di dalam SVG. Semua koordinat slot di bawah
     * bersifat LOKAL terhadap anchor ini, karena kartu bisa dimiringkan. */
    anchor: {
      x: Math.round(msgNode.matrix[4] * 100) / 100,
      y: Math.round(msgNode.matrix[5] * 100) / 100,
      matrix: msgNode.matrix.map((v) => Math.round(v * 10000) / 10000),
      rotated: Math.abs(msgNode.matrix[1]) > 1e-6,
    },
    message: {
      x: msgX,
      y: msgY,
      fontSize,
      lineHeight,
      lineRatio: Number((lineHeight / fontSize).toFixed(4)),
      weight: num(msgNode.attrs, 'font-weight', 400),
      letterSpacing,
      fill: attr(msgNode.attrs, 'fill'),
      maxWidth,
      widthSource,
      bottom,
      bottomSource: bottomEdge ? bottomEdge.source : null,
      maxLines,
      exampleLines: exampleLines.length,
      widestExample: Math.round(widestExample),
    },
    quote,
    obstacles,
    user: slotOf('editable-user'),
    time: slotOf('editable-time'),
    meta,
    footer: slotOf('editable-footer'),
    flags,
  };
}

export function measureDir(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.svg'))
    .sort()
    .map((f) => measureTemplate(path.join(dir, f)));
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const args = { dir: 'assets/templates', json: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir') args.dir = argv[++i];
    else if (argv[i] === '--json') args.json = argv[++i];
  }
  return args;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(BACKEND_ROOT, args.dir);
  if (!fs.existsSync(dir)) {
    console.error(`Folder tidak ditemukan: ${dir}`);
    process.exit(1);
  }

  const results = measureDir(dir);
  const failed = results.filter((r) => r.error);

  console.log(`\n${results.length} template diukur dari ${dir}\n`);

  const cols = [
    ['template', 22],
    ['anchor', 11],
    ['rot', 4],
    ['fs', 3],
    ['lh', 4],
    ['maxW', 5],
    ['bottom', 7],
    ['maxLn', 6],
    ['qFs', 4],
    ['qMax', 5],
    ['qY', 5],
    ['qH', 5],
    ['qW', 5],
    ['q1st', 5],
  ];
  console.log(cols.map(([n, w]) => n.padEnd(w)).join(''));
  console.log('-'.repeat(cols.reduce((s, [, w]) => s + w, 0)));

  for (const r of results) {
    if (r.error) {
      console.log(`${r.file.padEnd(22)} ERROR: ${r.error}`);
      continue;
    }
    const m = r.message;
    const q = r.quote || {};
    console.log(
      [
        String(r.key).padEnd(22),
        `${r.anchor.x},${r.anchor.y}`.padEnd(11),
        (r.anchor.rotated ? 'ya' : '-').padEnd(4),
        String(m.fontSize).padEnd(3),
        String(m.lineHeight).padEnd(4),
        String(m.maxWidth ?? '-').padEnd(5),
        String(m.bottom ?? '-').padEnd(7),
        String(m.maxLines ?? '-').padEnd(6),
        String(q.fontSize ?? '-').padEnd(4),
        String(q.maxLines ?? '-').padEnd(5),
        String(q.y ?? '-').padEnd(5),
        String(q.height ?? '-').padEnd(5),
        String(q.width ?? '-').padEnd(5),
        String(q.firstCap ?? '-').padEnd(5),
      ].join('')
    );
  }

  console.log('\n— catatan —');
  let flagged = 0;
  for (const r of results) {
    if (r.error || !r.flags.length) continue;
    flagged += 1;
    console.log(`  ${String(r.key).padEnd(22)} ${r.flags.join(' | ')}`);
  }
  if (!flagged) console.log('  (tidak ada)');

  if (args.json) {
    const outPath = path.resolve(BACKEND_ROOT, args.json);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    console.log(`\nJSON: ${outPath}`);
  }

  if (failed.length) {
    console.error(`\n${failed.length} template gagal diukur.`);
    process.exit(1);
  }
}
