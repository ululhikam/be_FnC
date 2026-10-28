import { prisma } from '../config/prisma.js';
import { getOrSet, invalidateCache } from '../utils/cache.util.js';

/**
 * Katalog template kartu. Sumber kebenaran ada di tabel `Template` (Postgres),
 * bukan di konstanta kode: SVG + geometri slot diisi oleh
 * `scripts/import-templates.mjs` yang mengukur langsung dari file desain.
 *
 * 38 template lama masih memakai `constants/templates.ts` (renderer CSS/SVG
 * generatif). Baris DB dengan `renderer = 'legacy'` disediakan untuk masa
 * transisi, tapi renderer-nya tetap jalur lama.
 */

/** Satu slot teks/geometri di dalam SVG template (koordinat lokal ke `anchor`). */
export interface TemplateMessageSlot {
  x: number;
  y: number;
  maxWidth: number;
  fontSize: number;
  lineHeight: number;
  lineRatio?: number;
  maxLines: number;
  weight?: number;
  letterSpacing?: number;
  fill?: string;
  bottom: number;
}

export interface TemplateQuoteSlot {
  x: number;
  y: number;
  width: number;
  height: number;
  maxLines: number;
  fontSize: number;
  lineHeight: number;
  padq: number;
  header: number;
  foot?: number;
  stroke?: string;
  fill?: string;
  ink?: string;
  muted?: string;
  accent?: string;
}

export interface TemplateTextSlot {
  x: number;
  y: number;
  fontSize: number;
  weight?: number;
  fill?: string;
  anchor?: string;
}

export interface TemplateSlots {
  anchor?: { x: number; y: number; matrix?: number[]; rotated?: boolean };
  message: TemplateMessageSlot;
  quote?: TemplateQuoteSlot | null;
  user?: TemplateTextSlot | null;
  time?: TemplateTextSlot | null;
  meta?: { handle: TemplateTextSlot; time: TemplateTextSlot } | null;
  footer?: TemplateTextSlot | null;
  obstacles?: unknown[];
  flagged?: string[];
}

export interface TemplateRecord {
  key: string;
  label: string;
  description?: string | null;
  category?: string | null;
  renderer: string;
  aspect: string;
  width: number;
  height: number;
  svgSource: string;
  slots: TemplateSlots;
  palette: { bg?: string; ink?: string; accent?: string } | null;
  thumbnailUrl?: string | null;
  version: number;
  status: string;
  sortOrder: number;
}

/** Baris katalog tanpa `svgSource` (dipakai endpoint daftar template). */
export type TemplateSummaryRecord = Omit<TemplateRecord, 'svgSource'>;

const TTL_MS = 60_000;
const CACHE_PREFIX = 'template:';

/** Kolom yang dibutuhkan renderer & pemilih template. `svgSource` hanya diambil bila diminta. */
const BASE_SELECT = {
  key: true,
  label: true,
  description: true,
  category: true,
  renderer: true,
  aspect: true,
  width: true,
  height: true,
  slots: true,
  palette: true,
  thumbnailUrl: true,
  version: true,
  status: true,
  sortOrder: true,
} as const;

export class TemplateService {
  /** Baris template apa pun statusnya (dipakai renderer & admin). */
  static async getByKey(key: string): Promise<TemplateRecord | null> {
    const normalized = String(key || '').trim();
    if (!normalized) return null;
    return getOrSet(`${CACHE_PREFIX}${normalized}`, TTL_MS, async () => {
      const row = await prisma.template.findUnique({
        where: { key: normalized },
        select: { ...BASE_SELECT, svgSource: true },
      });
      return (row as unknown as TemplateRecord | null) ?? null;
    });
  }

  /** Hanya template aktif — dipakai validasi pembuatan fess & pemilih di frontend. */
  static async getActive(key: string): Promise<TemplateRecord | null> {
    const row = await TemplateService.getByKey(key);
    return row && row.status === 'active' ? row : null;
  }

  /** Daftar template aktif untuk pemilih (tanpa `svgSource`, payload tetap kecil). */
  static async listActive(): Promise<TemplateSummaryRecord[]> {
    return getOrSet(`${CACHE_PREFIX}list:active`, TTL_MS, async () => {
      const rows = await prisma.template.findMany({
        where: { status: 'active' },
        orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
        select: BASE_SELECT,
      });
      return rows as unknown as TemplateSummaryRecord[];
    });
  }

  /** Dipanggil setelah import/ubah template agar tidak ada data basi. */
  static invalidate(key?: string): void {
    if (key) invalidateCache(`${CACHE_PREFIX}${key}`);
    // Awalan `template:` mencakup `template:list:` dan seluruh cache per key.
    invalidateCache(CACHE_PREFIX);
  }
}