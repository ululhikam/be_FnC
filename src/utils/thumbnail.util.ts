/**
 * Fungsi murni untuk thumbnail cover Instagram.
 *
 * Semua helper di sini bebas I/O (tidak menyentuh DB, storage, jaringan) supaya
 * bisa diuji tanpa mock: pemilihan foto, palet warna dari piksel, kontras,
 * auto-fit judul, alokasi slot carousel, dan fallback judul deterministik.
 */

export const THUMBNAIL_WIDTH = 1080;
export const THUMBNAIL_HEIGHT = 1350;
/** Batas keras carousel Instagram. */
export const CAROUSEL_MAX_ITEMS = 10;
export const TITLE_MAX_CHARS = 60;
export const TITLE_MIN_WORDS = 3;
export const TITLE_MAX_WORDS = 5;
export const TITLE_MAX_LINES = 4;
/**
 * Berapa langkah penurunan font yang dicoba untuk menghindari baris terakhir
 * berisi satu kata saja. 0 = pakai font terbesar yang muat.
 */
const WIDOW_SEARCH_STEPS = 5;
export const FALLBACK_TITLE = 'Curhat Anonim';
export const FALLBACK_HANDLE = '@fessncurious';
export const FALLBACK_HOST = 'www.fnc.web.id';

export interface CoverMedia {
  id: string | null;
  url: string;
}

/**
 * Pilih foto yang dipakai sebagai background cover: media gambar pertama yang
 * punya URL publik HTTP(S). Data-URI dilewati karena tidak bisa dipakai ulang
 * oleh worker Instagram dan boros memori.
 */
export function selectCoverMedia(media: unknown): CoverMedia | null {
  if (!Array.isArray(media)) return null;
  for (const entry of media) {
    const url = String((entry as any)?.url || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (String((entry as any)?.type || 'image').toLowerCase() === 'video') continue;
    const id = String((entry as any)?.id || '').trim();
    return { id: id || null, url };
  }
  return null;
}

export interface CarouselSlotInput {
  cardCount: number;
  mediaCount: number;
  withThumbnail: boolean;
}

export interface CarouselSlotPlan {
  /** Jumlah kartu teks yang boleh diposting setelah thumbnail & media. */
  maxCards: number;
  /** Jumlah kartu yang terpaksa dipotong (0 = semua masuk). */
  droppedCards: number;
  /** Thumbnail benar-benar mendapat slot. */
  withThumbnail: boolean;
}

/**
 * Alokasi slot carousel: thumbnail dan media user tidak boleh menggeser satu
 * sama lain; yang dikorbankan adalah kartu teks (buatan sistem).
 */
export function allocateCarouselSlots(input: CarouselSlotInput): CarouselSlotPlan {
  const mediaCount = clampInt(input.mediaCount, 0, CAROUSEL_MAX_ITEMS);
  const cardCount = clampInt(input.cardCount, 0, CAROUSEL_MAX_ITEMS);
  const withThumbnail = Boolean(input.withThumbnail);
  const reserved = mediaCount + (withThumbnail ? 1 : 0);
  const maxCards = Math.max(0, CAROUSEL_MAX_ITEMS - reserved);
  return {
    maxCards,
    droppedCards: Math.max(0, cardCount - maxCards),
    withThumbnail,
  };
}

export function clampInt(value: unknown, min: number, max: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

// ── Warna ──────────────────────────────────────────────────────────────────

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb` / `#rrggbb` menjadi RGB; null bila bukan hex valid. */
export function parseHex(value: unknown): Rgb | null {
  const hex = String(value ?? '').trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  }
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!full) return null;
  return {
    r: parseInt(full[1], 16),
    g: parseInt(full[2], 16),
    b: parseInt(full[3], 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map((channel) => clampInt(channel, 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Campur dua warna (amount 0 = a, 1 = b). */
export function mixHex(a: string, b: string, amount: number): string {
  const first = parseHex(a);
  const second = parseHex(b);
  if (!first || !second) return first ? toHex(first) : b;
  const t = Math.min(1, Math.max(0, Number(amount) || 0));
  return toHex({
    r: Math.round(first.r + (second.r - first.r) * t),
    g: Math.round(first.g + (second.g - first.g) * t),
    b: Math.round(first.b + (second.b - first.b) * t),
  });
}

/** Gelapkan warna dengan mencampurnya ke hitam. */
export function darkenHex(color: string, amount = 0.35): string {
  return mixHex(color, '#000000', amount);
}

/** Terangkan warna dengan mencampurnya ke putih. */
export function lightenHex(color: string, amount = 0.35): string {
  return mixHex(color, '#ffffff', amount);
}

export function rgba(color: string, alpha: number): string {
  const rgb = parseHex(color);
  if (!rgb) return `rgba(0,0,0,${clampFloat(alpha, 0, 1)})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${round(clampFloat(alpha, 0, 1), 3)})`;
}

function clampFloat(value: unknown, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Luminance relatif (WCAG) dari hex; null bila warna tidak valid. */
export function relativeLuminance(color: string): number | null {
  const rgb = parseHex(color);
  if (!rgb) return null;
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rasio kontras WCAG antara dua warna (1..21). */
export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  if (a === null || b === null) return 0;
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return round((lighter + 0.05) / (darker + 0.05), 2);
}

/** Pilih warna teks (putih atau near-black) yang paling kontras di atas warna tertentu. */
export function pickInkColor(background: string): string {
  const white = contrastRatio(background, '#ffffff');
  const ink = contrastRatio(background, '#0b0d14');
  return white >= ink ? '#ffffff' : '#0b0d14';
}

/**
 * Kuantisasi piksel (RGB/RGBA) menjadi palet kecil, diurutkan dari bobot
 * terbesar. Deterministik: bucket 32 dan tanpa random.
 */
export interface PaletteColor {
  hex: string;
  weight: number;
}

export function quantizePalette(pixels: Buffer, channels = 3, bucketSize = 32): PaletteColor[] {
  if (!Buffer.isBuffer(pixels) || pixels.length === 0) return [];
  const step = clampInt(channels, 1, 4);
  const bucket = clampInt(bucketSize, 1, 255);
  const counts = new Map<string, { count: number; r: number; g: number; b: number }>();

  for (let offset = 0; offset + step - 1 < pixels.length; offset += step) {
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    // Abaikan piksel nyaris transparan (PNG hasil resize bisa menyisakan alpha).
    if (step === 4 && pixels[offset + 3] < 16) continue;
    const key = `${Math.floor(r / bucket)}-${Math.floor(g / bucket)}-${Math.floor(b / bucket)}`;
    const entry = counts.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    entry.count += 1;
    entry.r += r;
    entry.g += g;
    entry.b += b;
    counts.set(key, entry);
  }

  const total = Array.from(counts.values()).reduce((sum, entry) => sum + entry.count, 0);
  if (!total) return [];

  return Array.from(counts.values())
    .map((entry) => ({
      hex: toHex({
        r: Math.round(entry.r / entry.count),
        g: Math.round(entry.g / entry.count),
        b: Math.round(entry.b / entry.count),
      }),
      weight: round(entry.count / total, 4),
    }))
    .sort((a, b) => b.weight - a.weight || a.hex.localeCompare(b.hex));
}

/** Warna dominan dari buffer piksel; null bila buffer kosong. */
export function dominantColor(pixels: Buffer, channels = 3): string | null {
  return quantizePalette(pixels, channels)[0]?.hex || null;
}

export interface GradientStop {
  offset: number;
  color: string;
  alpha: number;
}

/**
 * Gradien overlay 3 stop dari warna dominan foto: transparan di atas, pekat di
 * bawah agar judul & watermark terbaca. Warna digelapkan 40% lebih dulu.
 */
export function buildGradientStops(dominant: string | null, accentFallback = '#0055ff'): GradientStop[] {
  const base = parseHex(dominant) ? String(dominant) : accentFallback;
  const tone = darkenHex(base, 0.4);
  return [
    { offset: 0, color: tone, alpha: 0.12 },
    { offset: 0.45, color: tone, alpha: 0.45 },
    { offset: 1, color: darkenHex(tone, 0.25), alpha: 0.94 },
  ];
}

/**
 * Rata-rata luminance *gamma* (0..1) dari buffer piksel RGB/RGBA — dipakai
 * untuk menentukan kekuatan plat judul. Cepat dan deterministik.
 */
export function meanGammaLuminance(pixels: Buffer, channels = 3): number {
  if (!Buffer.isBuffer(pixels) || pixels.length === 0) return 0;
  const step = clampInt(channels, 1, 4);
  let sum = 0;
  let count = 0;
  for (let offset = 0; offset + step - 1 < pixels.length; offset += step) {
    if (step === 4 && pixels[offset + 3] < 16) continue;
    sum +=
      0.2126 * (pixels[offset] / 255) +
      0.7152 * (pixels[offset + 1] / 255) +
      0.0722 * (pixels[offset + 2] / 255);
    count += 1;
  }
  return count ? round(sum / count, 4) : 0;
}

/**
 * Alpha plat judul berdasarkan kecerahan foto di belakang judul.
 *
 * Foto terang butuh plat lebih pekat agar judul putih tetap lolos kontras;
 * foto gelap cukup plat tipis supaya foto masih terlihat. Input adalah
 * luminance gamma (rata-rata channel 0..1), bukan luminance linear.
 */
export function panelAlphaForLuminance(meanLuminance: number, min = 0.32, max = 0.86): number {
  const luminance = clampFloat(meanLuminance, 0, 1);
  const alpha = 0.32 + 0.85 * (luminance - 0.15);
  return round(Math.min(max, Math.max(min, alpha)), 2);
}

/**
 * Gelapkan overlay bertahap sampai kontras judul lolos target. Mengembalikan
 * alpha tambahan (0..1) yang ditumpuk di atas gradien dasar.
 */
export function overlayAlphaForContrast(
  titleColor: string,
  background: string,
  target = 7
): number {
  if (contrastRatio(titleColor, background) >= target) return 0;
  let alpha = 0.2;
  while (alpha < 0.85) {
    const blended = mixHex(background, '#000000', alpha);
    if (contrastRatio(titleColor, blended) >= target) return round(alpha, 2);
    alpha += 0.15;
  }
  return 0.85;
}

// ── Judul ──────────────────────────────────────────────────────────────────

/** Normalisasi teks judul: buang markup, URL, mention, email, dan telepon. */
export function sanitizeTitleText(raw: unknown, maxChars = TITLE_MAX_CHARS): string {
  let text = String(raw ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ')
    .replace(/(?:\+?62|0)8\d{7,12}/g, ' ')
    .replace(/[@#][\w.-]+/g, ' ')
    .replace(/[*_~`>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(' ');
    text = (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
  }
  return text.replace(/^[\s.,;:!?\-–—]+|[\s,;:\-–—]+$/g, '');
}

const LEADING_FILLERS = new Set([
  'jadi',
  'dan',
  'tapi',
  'terus',
  'lalu',
  'karena',
  'kalau',
  'kalo',
  'nih',
  'eh',
  'yah',
  'ya',
  'kan',
  'aku',
  'gue',
  'gw',
  'gua',
  'saya',
  'kita',
  'kami',
  'dia',
]);

/**
 * Judul deterministik dari isi fess (dipakai saat AI mati/kuota habis dan
 * seluruh P1). Mengambil 3–5 kata pertama yang bermakna, maksimal 60 karakter.
 */
export function fallbackTitle(content: unknown, maxChars = TITLE_MAX_CHARS): string {
  const clean = sanitizeTitleText(content, 400);
  if (!clean) return FALLBACK_TITLE;

  // Prioritaskan kalimat pertama supaya judul tidak menyeberang topik.
  const sentence = clean.split(/[.!?\n]/)[0].trim() || clean;
  let words = sentence
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((word) => /[\p{L}\p{N}]/u.test(word));

  while (words.length > TITLE_MIN_WORDS && LEADING_FILLERS.has(words[0].toLowerCase())) {
    words = words.slice(1);
  }
  if (!words.length) return FALLBACK_TITLE;

  const picked: string[] = [];
  for (const word of words) {
    if (picked.length >= TITLE_MAX_WORDS) break;
    const candidate = [...picked, word].join(' ');
    if (candidate.length > maxChars) break;
    picked.push(word);
  }

  const title = (picked.length ? picked : words.slice(0, 1)).join(' ').trim();
  return title || FALLBACK_TITLE;
}

export interface FitTitleOptions {
  maxWidth: number;
  maxLines?: number;
  maxFontSize?: number;
  minFontSize?: number;
  maxCharsPerLine?: number;
  /** Pengukur lebar teks (mis. opentype.js); default rasio 0.55 × fontSize. */
  measure?: (text: string, fontSize: number) => number;
  /** Langkah penurunan font dalam px. */
  step?: number;
}

export interface FittedTitle {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  fits: boolean;
}

/**
 * Auto-fit judul: coba ukuran font terbesar → terkecil, bungkus per kata, dan
 * terima konfigurasi pertama yang muat dalam `maxLines`. Bila tidak ada yang
 * muat, kembalikan ukuran minimum dengan baris terakhir dipotong + elipsis.
 */
export function fitTitle(text: string, options: FitTitleOptions): FittedTitle {
  const content = sanitizeTitleText(text);
  const maxWidth = Math.max(1, Number(options.maxWidth) || 1);
  const maxLines = clampInt(options.maxLines ?? TITLE_MAX_LINES, 1, 6);
  const maxFontSize = Math.max(8, Number(options.maxFontSize) || 88);
  const minFontSize = Math.max(8, Math.min(maxFontSize, Number(options.minFontSize) || 44));
  const maxCharsPerLine = clampInt(options.maxCharsPerLine ?? 22, 6, 80);
  const step = Math.max(1, Number(options.step) || 4);
  const measure = options.measure || ((value: string, size: number) => value.length * size * 0.55);

  if (!content) {
    return { lines: [FALLBACK_TITLE], fontSize: minFontSize, lineHeight: Math.round(minFontSize * 1.12), fits: true };
  }

  let lastLines: string[] = [];
  let firstFit: FittedTitle | null = null;
  for (let size = maxFontSize; size >= minFontSize; size -= step) {
    const lines = wrapTitle(content, size, maxWidth, maxCharsPerLine, measure);
    lastLines = lines;
    if (lines.length > maxLines) continue;

    const fitted: FittedTitle = {
      lines,
      fontSize: size,
      lineHeight: Math.round(size * 1.12),
      fits: true,
    };
    if (!firstFit) firstFit = fitted;
    // Hindari baris terakhir yang hanya berisi satu kata ("widow"): turunkan
    // ukuran font beberapa langkah untuk mendapat pembagian baris lebih rapi.
    if (!hasWidowLine(lines)) return fitted;
    if (size <= firstFit.fontSize - step * WIDOW_SEARCH_STEPS) break;
  }
  if (firstFit) return firstFit;

  const lines = lastLines.slice(0, maxLines);
  if (lines.length) {
    const last = lines.length - 1;
    lines[last] = ellipsize(lines[last], minFontSize, maxWidth, measure);
  }
  return {
    lines: lines.length ? lines : [FALLBACK_TITLE],
    fontSize: minFontSize,
    lineHeight: Math.round(minFontSize * 1.12),
    fits: false,
  };
}

/** Baris terakhir hanya satu kata = widow yang membuat judul terlihat tanggung. */
function hasWidowLine(lines: string[]): boolean {
  if (lines.length < 2) return false;
  return lines[lines.length - 1].trim().split(/\s+/).length === 1;
}

function wrapTitle(
  text: string,
  fontSize: number,
  maxWidth: number,
  maxCharsPerLine: number,
  measure: (text: string, fontSize: number) => number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const tooWide = measure(candidate, fontSize) > maxWidth;
    const tooLong = candidate.length > maxCharsPerLine;
    if (current && (tooWide || tooLong)) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function ellipsize(
  text: string,
  fontSize: number,
  maxWidth: number,
  measure: (text: string, fontSize: number) => number
): string {
  let value = text;
  while (value.length > 1 && measure(`${value}…`, fontSize) > maxWidth) {
    value = value.slice(0, -1).trimEnd();
  }
  return `${value}…`;
}

/** Watermark: handle base (bukan penulis) + host frontend aktif. */
export function watermarkLabel(baseHandle: unknown, frontendHost?: unknown): { handle: string; host: string } {
  const raw = String(baseHandle ?? '').trim();
  const handle = raw ? (raw.startsWith('@') ? raw : `@${raw}`) : FALLBACK_HANDLE;
  const host = String(frontendHost ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  return { handle, host: host || FALLBACK_HOST };
}

/** True bila base boleh membuat thumbnail (opt-out per base). */
export function isThumbnailModeAllowed(mode: unknown): boolean {
  const value = String(mode ?? 'auto')
    .trim()
    .toLowerCase();
  return value === 'auto' || value === 'no_ai';
}