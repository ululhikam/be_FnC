/**
 * Ekstraksi teks contoh dari SVG template untuk prompt AI.
 *
 * Hanya teks yang dikirim ke provider — bukan atribut, komentar, atau markup.
 * SVG sudah dinormalisasi & lolos `assertSafeSvg` sebelum sampai di sini
 * (lihat `utils/template-admin.util.ts`), jadi fungsi ini murni pengurai teks
 * tanpa tanggung jawab keamanan.
 */

/** Batas baris teks yang dikirim; sisanya dibuang agar prompt tetap murah. */
export const TEMPLATE_TEXT_MAX_LINES = 20;
/** Batas panjang tiap baris; deskripsi panjang dipotong di batas kata. */
export const TEMPLATE_TEXT_MAX_CHARS = 120;

const TEXT_NODE_RE = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const TAG_RE = /<[^>]*>/g;
const WHITESPACE_RE = /\s+/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decode entitas XML yang umum (nama maupun numerik) tanpa dependency. */
export function decodeXmlEntities(value: string): string {
  return String(value ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? safeFromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? safeFromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[lower] ?? match;
  });
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function normaliseLine(raw: string): string {
  return decodeXmlEntities(String(raw ?? '').replace(TAG_RE, ' '))
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(WHITESPACE_RE, ' ')
    .trim();
}

/** Potong di batas kata (fallback ke potongan keras bila tak ada spasi). */
function truncateLine(line: string, maxChars: number): string {
  if (line.length <= maxChars) return line;
  const cut = line.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Ambil teks contoh dari setiap `<text>` (termasuk isi `<tspan>`).
 *
 * Duplikat dibuang (tidak ada gunanya mengirim baris yang sama dua kali) dan
 * urutan kemunculan dipertahankan supaya konteks visual tetap masuk akal.
 */
export function extractTemplateTexts(
  svg: string,
  options: { maxLines?: number; maxChars?: number } = {}
): string[] {
  const maxLines = Math.max(1, Math.trunc(options.maxLines ?? TEMPLATE_TEXT_MAX_LINES));
  const maxChars = Math.max(8, Math.trunc(options.maxChars ?? TEMPLATE_TEXT_MAX_CHARS));

  const source = String(svg ?? '').replace(COMMENT_RE, ' ');
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const match of source.matchAll(TEXT_NODE_RE)) {
    const line = truncateLine(normaliseLine(match[1] || ''), maxChars);
    if (!line) continue;
    const fingerprint = line.toLowerCase();
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    lines.push(line);
    if (lines.length >= maxLines) break;
  }

  return lines;
}