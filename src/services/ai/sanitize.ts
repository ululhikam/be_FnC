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
// ── Metadata template (P3) ─────────────────────────────────────────────────

export const TEMPLATE_LABEL_MIN_CHARS = 3;
export const TEMPLATE_LABEL_MAX_CHARS = 40;
export const TEMPLATE_DESCRIPTION_MIN_CHARS = 40;
export const TEMPLATE_DESCRIPTION_MAX_CHARS = 160;
export const TEMPLATE_RATIONALE_MAX_CHARS = 160;

export interface TemplateMetadataValue {
  label: string;
  description: string;
  category: string;
  confidence: number;
  rationale: string | null;
}

export interface SanitizeTemplateMetadataContext {
  /** Allowlist kategori; default empat kategori katalog. */
  categories?: readonly string[];
}

const DEFAULT_TEMPLATE_CATEGORIES = ['classic', 'campus', 'playful', 'editorial'];

/** Kata sambung yang tetap huruf kecil di tengah label ("Papan dan Kartu"). */
const LABEL_STOPWORDS = new Set([
  'dan',
  'di',
  'ke',
  'dari',
  'untuk',
  'yang',
  'atau',
  'pada',
  'dengan',
  'the',
  'of',
  'and',
]);

/**
 * Title Case untuk `label` katalog (§8.2: "Title Case").
 *
 * Berbeda dari `normalizeTitleCase` (judul cover: hanya huruf awal kalimat),
 * label harus kapital di setiap kata. Akronim pendek (BEM, HIMA) dibiarkan.
 */
function toLabelTitleCase(text: string): string {
  return text
    .split(' ')
    .map((word, index) => {
      const bare = word.replace(/[^\p{L}\p{N}]/gu, '');
      if (!bare) return word;
      if (bare.length <= 4 && bare === bare.toUpperCase()) return word;
      if (index > 0 && LABEL_STOPWORDS.has(bare.toLowerCase())) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Validasi keluaran model untuk metadata template.
 *
 * Mengembalikan `null` bila label/deskripsi tidak memenuhi syarat — pemanggil
 * menampilkan error, bukan menyimpan metadata asal-asalan. `category` di luar
 * allowlist selalu jatuh ke `classic` (aman & tetap berguna).
 */
export function sanitizeTemplateMetadata(
  raw: unknown,
  context: SanitizeTemplateMetadataContext = {}
): TemplateMetadataValue | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const categories = (context.categories?.length
    ? context.categories
    : DEFAULT_TEMPLATE_CATEGORIES
  ).map((value) => String(value).toLowerCase());

  const label = cleanOneLine(source.label, TEMPLATE_LABEL_MAX_CHARS);
  if (!label || label.length < TEMPLATE_LABEL_MIN_CHARS) return null;

  const description = cleanDescription(source.description);
  if (!description) return null;

  const categoryRaw = String(source.category ?? '')
    .trim()
    .toLowerCase();
  const category = categories.includes(categoryRaw) ? categoryRaw : categories[0] || 'classic';

  return {
    label: toLabelTitleCase(label),
    description,
    category,
    confidence: clampConfidence(source.confidence),
    rationale: cleanOneLine(source.rationale, TEMPLATE_RATIONALE_MAX_CHARS) || null,
  };
}

/** Bersihkan satu baris: tanpa markup/URL/emoji/kontrol, dipotong di batas kata. */
function cleanOneLine(raw: unknown, maxChars: number): string {
  const text = String(raw ?? '')
    .normalize('NFC')
    .replace(ZERO_WIDTH_RE, '')
    .replace(CONTROL_RE, ' ')
    .replace(TAG_RE, ' ')
    .replace(URL_RE, ' ')
    .replace(EMAIL_RE, ' ')
    .replace(MENTION_RE, ' ')
    .replace(EMOJI_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’(\[]+|["'“”‘’)\]]+$/g, '')
    .replace(/[\s.,;:!?\-–—]+$/g, '');

  return truncateAtWord(text, maxChars);
}

/** Deskripsi: satu kalimat, 40–160 karakter, tanpa emoji/markup. */
function cleanDescription(raw: unknown): string | null {
  const text = cleanOneLine(raw, 400);
  if (!text) return null;

  // Ambil kalimat pertama saja supaya deskripsi katalog tetap ringkas.
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0].trim();
  const sentence = truncateAtWord(firstSentence, TEMPLATE_DESCRIPTION_MAX_CHARS);
  if (sentence.length < TEMPLATE_DESCRIPTION_MIN_CHARS) return null;
  return sentence;
}

function truncateAtWord(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut)
    .replace(/[\s.,;:!?\-–—]+$/g, '')
    .trim();
}

function clampConfidence(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

// ── Asisten konsol Super Admin ─────────────────────────────────────────────

export const ASSISTANT_REPLY_MAX_CHARS = 1200;
export const ASSISTANT_VALUE_MAX_CHARS = 500;
export const ASSISTANT_MAX_SUGGESTIONS = 12;
export const ASSISTANT_MAX_REASON_CHARS = 160;

export interface AssistantFieldSpec {
  name: string;
  type?: string;
}

export interface AssistantSuggestion {
  field: string;
  value: string;
  reason: string | null;
}

export interface AssistantOutput {
  reply: string;
  suggestions: AssistantSuggestion[];
}

/**
 * Bersihkan jawaban asisten konsol.
 *
 * Hanya field yang benar-benar ada di formulir yang boleh diusulkan — model
 * tidak bisa "mengarang" nama field baru. Nilai numerik dipaksa berisi angka
 * saja supaya tidak ada teks yang masuk ke input angka lalu gagal validasi.
 * Mengembalikan `null` bila tidak ada isi yang berguna.
 */
export function sanitizeAssistantOutput(
  raw: unknown,
  allowed: AssistantFieldSpec[]
): AssistantOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;

  const reply = cleanAssistantReply(source.reply);
  const allowedByName = new Map(
    (Array.isArray(allowed) ? allowed : [])
      .map((field) => [String(field?.name || '').trim(), String(field?.type || 'text')] as const)
      .filter(([name]) => Boolean(name))
  );

  const seen = new Set<string>();
  const suggestions: AssistantSuggestion[] = [];
  const list = Array.isArray(source.suggestions) ? source.suggestions : [];

  for (const item of list) {
    if (suggestions.length >= ASSISTANT_MAX_SUGGESTIONS) break;
    if (!item || typeof item !== 'object') continue;

    const entry = item as Record<string, unknown>;
    const field = String(entry.field ?? '').trim();
    if (!field || seen.has(field) || !allowedByName.has(field)) continue;

    const value = cleanAssistantValue(entry.value, allowedByName.get(field) || 'text');
    if (!value) continue;

    seen.add(field);
    suggestions.push({
      field,
      value,
      reason: cleanOneLine(entry.reason, ASSISTANT_MAX_REASON_CHARS) || null,
    });
  }

  if (!reply && !suggestions.length) return null;
  return { reply, suggestions };
}

/** Balasan boleh beberapa baris, tetapi tetap dibatasi panjangnya. */
function cleanAssistantReply(raw: unknown): string {
  const text = String(raw ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[*_`#>]+/g, '')
    .replace(/[^\S\n]+$/gm, '')
    .trim();

  if (!text) return '';
  const lines = text.split('\n').slice(0, 8);
  return truncateAtWord(lines.join('\n').trim(), ASSISTANT_REPLY_MAX_CHARS);
}

/**
 * Nilai field: tanpa markup/emoji/kontrol. Untuk field angka, hanya digit yang
 * dipertahankan (pemisah ribuan dibuang) agar cocok dengan input `type=number`.
 */
function cleanAssistantValue(raw: unknown, type: string): string {
  const text = String(raw ?? '')
    .normalize('NFC')
    .replace(ZERO_WIDTH_RE, '')
    .replace(CONTROL_RE, ' ')
    .replace(TAG_RE, ' ')
    .replace(EMOJI_RE, '')
    .trim();

  if (!text) return '';

  if (type === 'number') {
    const digits = text.replace(/[^\d]/g, '');
    return digits ? digits.slice(0, 18) : '';
  }

  const cleaned = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/^["'“”‘’(\[]+|["'“”‘’)\]]+$/g, '');

  return truncateAtWord(cleaned, ASSISTANT_VALUE_MAX_CHARS);
}
