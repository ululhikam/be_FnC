/**
 * Sanitasi keluaran AI (judul cover).
 *
 * Semua fungsi murni: tidak menyentuh jaringan/DB supaya mudah diuji. Aturan
 * mengikuti `docs/ai-thumbnail-and-template-metadata-plan.md` §7.3.
 */

export const TITLE_MIN_CHARS = 8;
export const TITLE_MAX_CHARS = 60;
export const TITLE_MIN_WORDS = 3;
export const TITLE_MAX_WORDS = 5;

/** Kata klikbait internal yang tidak boleh muncul di judul. */
const CLICKBAIT_WORDS = ['viral', 'auto viral', 'bocor', 'bocoran', 'wajib nonton'];

const ZERO_WIDTH_RE = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const URL_RE = /https?:\/\/\S+|\bwww\.\S+/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const MENTION_RE = /[@#][\w.-]+/g;
const PHONE_RE = /(?:\+?62|0)8\d{7,12}/g;
const LONG_DIGITS_RE = /\d{8,}/g;
const TAG_RE = /<[^>]*>/g;

/**
 * Rapikan teks untuk dikirim ke provider: normalisasi, buang PII yang tidak
 * perlu (email/telepon/URL/mention), lalu potong di batas kata.
 *
 * Nama orang tidak bisa dideteksi tanpa model NER; karena itu prompt meminta
 * model tidak memakai nama, dan keluaran tetap disaring di `sanitizeTitle`.
 */
export function scrubPromptInput(raw: unknown, maxChars = 1200): string {
  const text = String(raw ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(URL_RE, ' ')
    .replace(EMAIL_RE, ' ')
    .replace(PHONE_RE, ' ')
    .replace(MENTION_RE, ' ')
    .replace(ZERO_WIDTH_RE, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const limit = Math.max(16, Math.trunc(maxChars) || 1200);
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Parse JSON dari jawaban model, toleran terhadap pagar kode ```json dan teks
 * pengantar. Mengembalikan `null` bila tidak ada objek JSON yang valid.
 */
export function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  const text = String(raw ?? '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (!text) return null;

  const candidates = [text];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* coba kandidat berikutnya */
    }
  }
  return null;
}

export interface SanitizeTitleContext {
  /** Kata terlarang milik base (dari `Base.bannedWords`). */
  bannedWords?: string[] | null;
  maxChars?: number;
}

/**
 * Validasi & normalisasi judul keluaran model.
 * Mengembalikan `null` bila judul harus ditolak (pemanggil memakai fallback).
 */
export function sanitizeTitle(raw: unknown, context: SanitizeTitleContext = {}): string | null {
  const maxChars = Math.max(TITLE_MIN_CHARS, Number(context.maxChars) || TITLE_MAX_CHARS);

  let text = String(raw ?? '')
    .normalize('NFC')
    .replace(ZERO_WIDTH_RE, '')
    .replace(CONTROL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return null;

  text = text
    .replace(TAG_RE, ' ')
    .replace(URL_RE, ' ')
    .replace(EMAIL_RE, ' ')
    .replace(MENTION_RE, ' ')
    .replace(PHONE_RE, ' ')
    .replace(LONG_DIGITS_RE, ' ')
    .replace(EMOJI_RE, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return null;
  if (containsBannedWord(text, context.bannedWords)) return null;
  if (containsBannedWord(text, CLICKBAIT_WORDS)) return null;

  // Buang tanda kutip/kurung (pembungkus keluaran model) dan tanda baca di ujung.
  text = text
    .replace(/^["'“”‘’(\[]+|["'“”‘’)\]]+$/g, '')
    .replace(/[\s.,;:!?\-–—]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return null;

  // Panjang diukur per grapheme (≈ code point) supaya emoji/aksen tidak salah hitung.
  let chars = Array.from(text);
  if (chars.length > maxChars) {
    const cut = chars.slice(0, maxChars);
    const joined = cut.join('');
    const lastSpace = joined.lastIndexOf(' ');
    text = (lastSpace > maxChars * 0.6 ? joined.slice(0, lastSpace) : joined)
      .replace(/[\s.,;:!?\-–—]+$/g, '')
      .trim();
    chars = Array.from(text);
  }
  if (chars.length < TITLE_MIN_CHARS) return null;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < TITLE_MIN_WORDS || words.length > TITLE_MAX_WORDS) return null;

  return normalizeTitleCase(text);
}

/** Judul ALL CAPS dari model diubah ke Title Case agar tidak "berteriak". */
export function normalizeTitleCase(text: string): string {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (!letters) return text;
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  const isShouting = upper / letters.length > 0.7;

  if (isShouting) {
    return text
      .toLowerCase()
      .replace(/(^|\s)(\p{L})/gu, (_, space: string, char: string) => space + char.toUpperCase());
  }
  return text.replace(/^(\p{Ll})/u, (char) => char.toUpperCase());
}

function containsBannedWord(text: string, words?: string[] | null): boolean {
  if (!Array.isArray(words) || !words.length) return false;
  const haystack = ` ${text.toLowerCase()} `;
  return words.some((word) => {
    const needle = String(word || '').trim().toLowerCase();
    if (!needle) return false;
    return haystack.includes(` ${needle} `) || haystack.includes(needle);
  });
}