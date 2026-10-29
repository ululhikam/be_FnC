/**
 * Thumbnail cover Instagram (slide indeks 0).
 *
 * Komposisi: foto user memenuhi seluruh kartu (cover, tanpa blur), lalu judul
 * kecil + handle base ditumpuk di area bawah dengan scrim gelap tipis supaya
 * teks terbaca tanpa menutupi foto.
 *
 * Judul: dibuat AI (P2) bila base memakai mode `auto` dan AI aktif; selain itu
 * `fallbackTitle()` deterministik. Judul bersifat final — tidak bisa diedit.
 */
import sharp from 'sharp';
import opentype from 'opentype.js';
import fs from 'fs';
import { ENV } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { getFontFileFor } from '../config/fonts.js';
import { StorageService } from './storage.service.js';
import { AiService } from './ai/ai.service.js';
import { fetchRemoteImage } from '../utils/remote-image.util.js';
import { renderSvgToPng } from '../utils/svg-render.util.js';
import { frontendHost } from '../utils/frontend-host.util.js';
import {
  THUMBNAIL_HEIGHT,
  THUMBNAIL_WIDTH,
  allocateCarouselSlots,
  dominantColor,
  fallbackTitle,
  fitTitle,
  isThumbnailModeAllowed,
  mixHex,
  parseHex,
  rgba,
  selectCoverMedia,
  watermarkLabel,
  type CarouselSlotPlan,
  type FittedTitle,
} from '../utils/thumbnail.util.js';

export const FALLBACK_PROMPT_VERSION = 'fallback';

/**
 * Id semu untuk pratinjau composer: tidak pernah ditulis ke ledger
 * `AiGeneration` (`targetId`), karena baris itu bukan fess nyata. Cache judul
 * tetap bekerja sehingga publish memakai hasil yang sama tanpa panggilan baru.
 */
export const PREVIEW_FESS_ID = 'preview';

const TITLE_MARGIN_X = 72;
/** Baseline baris terakhir judul (judul menempel di dasar kartu). */
const TITLE_LAST_BASELINE = 1238;
/** Dua pill footer: handle base (kiri) & URL platform (kanan). */
const PILL_TOP = 1264;
const PILL_HEIGHT = 60;
const PILL_GAP = 12;
const HANDLE_FONT_SIZE = 28;
const HANDLE_PADDING = 26;
const HOST_FONT_SIZE = 20;
const HOST_PADDING = 22;
const BRAND_FALLBACK = '#0055ff';
const NIGHT = '#05070c';

export interface ThumbnailFessInput {
  id: string;
  content: string;
  baseHandle: string;
  media?: unknown;
  base?: {
    id?: string | null;
    name?: string | null;
    thumbnailMode?: string | null;
    color?: string | null;
    /** Blacklist kata base; dipakai menolak judul AI yang tidak pantas. */
    bannedWords?: string[] | null;
  } | null;
  /** Topik & tag composer, hanya untuk konteks prompt AI. */
  topic?: string | null;
  tag?: string | null;
  thumbnailUrl?: string | null;
  thumbnailStatus?: string | null;
  thumbnailSourceMediaId?: string | null;
  thumbnailTitle?: string | null;
  thumbnailVersion?: number | null;
}

export interface ThumbnailResult {
  url: string;
  title: string;
  sourceMediaId: string | null;
  version: number;
}

export interface ThumbnailPreviewResult {
  dataUri: string;
  title: string;
  sourceMediaId: string | null;
}

interface RenderedCover {
  buffer: Buffer;
  dominant: string | null;
  title: string;
  /** `v1` (AI) atau `fallback` — dipakai mengukur rasio fallback. */
  promptVersion: string;
}

export class ThumbnailService {
  /** Kill switch global (render lokal, tanpa AI). */
  static isEnabled(): boolean {
    return ENV.THUMBNAIL_ENABLED;
  }

  /** Apakah base ini masih ingin thumbnail dibuat. */
  static isAllowedForBase(mode: unknown): boolean {
    return isThumbnailModeAllowed(mode);
  }

  /**
   * Alokasi slot carousel dengan thumbnail. Dipakai canvas.service supaya kartu
   * teks (bukan media user) yang dipotong saat batas 10 item tercapai.
   */
  static planSlots(input: {
    cardCount: number;
    mediaCount: number;
    withThumbnail: boolean;
  }): CarouselSlotPlan {
    return allocateCarouselSlots(input);
  }

  /**
   * Pastikan thumbnail siap untuk diposting. Mengembalikan `null` (tanpa
   * melempar) bila fitur mati, base opt-out, tidak ada foto, atau render gagal —
   * publish tetap berjalan seperti sebelumnya.
   */
  static async ensure(input: ThumbnailFessInput): Promise<ThumbnailResult | null> {
    if (!ThumbnailService.isEnabled()) return null;
    if (!ThumbnailService.isAllowedForBase(input.base?.thumbnailMode)) return null;

    const cover = selectCoverMedia(input.media);
    if (!cover) return null;

    // Reuse hasil yang masih valid untuk foto yang sama (retry worker, edit
    // caption, dsb.). Media tanpa id tidak pernah di-reuse agar tidak salah foto.
    if (
      cover.id &&
      input.thumbnailStatus === 'ready' &&
      input.thumbnailUrl &&
      input.thumbnailSourceMediaId === cover.id
    ) {
      return {
        url: input.thumbnailUrl,
        title: input.thumbnailTitle || fallbackTitle(input.content),
        sourceMediaId: cover.id,
        version: Number(input.thumbnailVersion) || 0,
      };
    }

    try {
      const rendered = await ThumbnailService.renderCover(input, cover.url);
      const nextVersion = Math.max(0, Number(input.thumbnailVersion) || 0) + 1;
      const uploaded = await StorageService.uploadBuffer({
        path: `canvas-thumbnails/${input.id}.jpg`,
        buffer: rendered.buffer,
        contentType: 'image/jpeg',
      });
      const url = withVersion(uploaded.url, nextVersion);

      await prisma.fess.update({
        where: { id: input.id },
        data: {
          thumbnailUrl: url,
          thumbnailTitle: rendered.title,
          thumbnailSourceMediaId: cover.id,
          thumbnailStatus: 'ready',
          thumbnailError: null,
          thumbnailPromptVersion: rendered.promptVersion,
          thumbnailGeneratedAt: new Date(),
          thumbnailVersion: nextVersion,
        },
      });

      return {
        url,
        title: rendered.title,
        sourceMediaId: cover.id,
        version: nextVersion,
      };
    } catch (err: any) {
      const message = clip(String(err?.message || 'Render thumbnail gagal.'), 500);
      console.warn('[Thumbnail] Gagal membuat thumbnail:', message);
      await persistThumbnailState(input.id, {
        thumbnailStatus: 'failed',
        thumbnailError: message,
      });
      await logThumbnail('error', `Thumbnail ${input.id} gagal: ${message}`);
      return null;
    }
  }

  /**
   * Render pratinjau (PNG data URI) tanpa upload & tanpa menyimpan apa pun.
   * Dipakai endpoint composer agar pratinjau identik dengan hasil publish.
   */
  static async renderPreview(
    input: Omit<ThumbnailFessInput, 'thumbnailUrl' | 'thumbnailStatus' | 'thumbnailSourceMediaId'>
  ): Promise<ThumbnailPreviewResult | null> {
    if (!ThumbnailService.isEnabled()) return null;
    if (!ThumbnailService.isAllowedForBase(input.base?.thumbnailMode)) return null;

    const cover = selectCoverMedia(input.media);
    if (!cover) return null;

    try {
      const rendered = await ThumbnailService.renderCover(input, cover.url);
      const png = await sharp(rendered.buffer).png().toBuffer();
      return {
        dataUri: `data:image/png;base64,${png.toString('base64')}`,
        title: rendered.title,
        sourceMediaId: cover.id,
      };
    } catch (err: any) {
      console.warn('[Thumbnail] Pratinjau gagal:', err?.message || err);
      return null;
    }
  }

  /** Render 1080×1350 JPEG. Melempar error agar pemanggil bisa mencatat status. */
  static async renderCover(input: ThumbnailFessInput, photoUrl: string): Promise<RenderedCover> {
    // Judul AI dimulai lebih dulu dan berjalan paralel dengan unduh foto,
    // supaya publish tidak menunggu dua proses berurutan.
    const titlePromise = resolveCoverTitle(input);

    const { buffer: photo } = await fetchRemoteImage(photoUrl, {
      maxBytes: ENV.THUMBNAIL_MAX_MEDIA_FETCH_BYTES,
      timeoutMs: ENV.THUMBNAIL_FETCH_TIMEOUT_MS,
    });

    // Palet dari foto kecil (deterministik, murah): dipakai bila base tidak
    // punya warna template yang valid.
    const palettePixels = await sharp(photo, { failOn: 'none' })
      .rotate()
      .resize(24, 30, { fit: 'cover', position: 'top' })
      .removeAlpha()
      .raw()
      .toBuffer();
    const dominant = dominantColor(palettePixels);

    const { title, promptVersion } = await titlePromise;
    const brand = resolveBrandColor(input.base?.color, dominant);
    const host = frontendHost();
    const layout = buildCoverLayout(title, input.baseHandle, host);

    // Foto memenuhi seluruh kartu (cover, tanpa pita judul). Judul kecil
    // ditumpuk di area bawah lewat scrim tipis, jadi foto tetap dominan.
    const background = await sharp(photo, { failOn: 'none' })
      .rotate()
      .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 92 })
      .toBuffer();

    const overlay = buildOverlaySvg({
      layout,
      brand,
    });

    const buffer = await sharp(background)
      .composite([{ input: renderOverlayPng(overlay), top: 0, left: 0 }])
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();

    return { buffer, dominant, title, promptVersion };
  }
}

/**
 * Judul cover: AI untuk base mode `auto`, fallback deterministik untuk `no_ai`
 * atau saat AI mati/gagal. Tidak pernah melempar — publish tidak boleh gagal
 * karena judul.
 */
async function resolveCoverTitle(
  input: ThumbnailFessInput
): Promise<{ title: string; promptVersion: string }> {
  const mode = String(input.base?.thumbnailMode || 'auto')
    .trim()
    .toLowerCase();

  if (mode !== 'auto' || !AiService.isTitleEnabled()) {
    return { title: fallbackTitle(input.content), promptVersion: FALLBACK_PROMPT_VERSION };
  }

  try {
    const result = await AiService.generateTitle({
      // Kuota dihitung per base; pratinjau memakai handle bila `base.id` tidak ada.
      baseId: String(input.base?.id || input.baseHandle || 'base'),
      baseHandle: input.baseHandle,
      baseName: input.base?.name || null,
      content: input.content,
      topic: input.topic || null,
      tag: input.tag || null,
      bannedWords: input.base?.bannedWords || [],
      // Ledger hanya untuk fess nyata; `PREVIEW_FESS_ID` bukan baris DB.
      targetId: input.id && input.id !== PREVIEW_FESS_ID ? input.id : null,
    });
    return {
      title: result.title,
      promptVersion: result.source === 'fallback' ? FALLBACK_PROMPT_VERSION : result.promptVersion,
    };
  } catch (err: any) {
    console.warn('[Thumbnail] Judul AI gagal, memakai fallback:', err?.message || err);
    return { title: fallbackTitle(input.content), promptVersion: FALLBACK_PROMPT_VERSION };
  }
}

// ── Tata letak judul bawah ─────────────────────────────────────────────────

/** Satu pill di footer thumbnail. */
interface FooterPill {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  textX: number;
  textBaseline: number;
  textAnchor: 'start' | 'end';
  /** Kekuatan garis tepi (handle lebih tegas dari URL). */
  stroke: number;
}

interface CoverLayout {
  fitted: FittedTitle;
  /** Baseline baris pertama judul. */
  firstBaseline: number;
  /** Baseline baris terakhir judul. */
  lastBaseline: number;
  /** Awal gradien gelap di bawah foto. */
  scrimTop: number;
  /** Garis aksen pendek di atas judul. */
  accentTop: number;
  /** Dua pill terpisah: handle base di kiri, URL platform di kanan. */
  pills: FooterPill[];
}

/**
 * Judul kecil di bawah: blok teks ditumpuk dari bawah ke atas supaya selalu
 * menempel di dasar kartu, berapa pun jumlah barisnya. Di bawahnya ada dua pill
 * rounded terpisah — handle base (kiri) dan URL platform (kanan).
 */
function buildCoverLayout(title: string, baseHandle: string, host: string): CoverLayout {
  const fitted = fitTitle(title, {
    // Faktor 0.95 memberi ruang aman: lebar glyph hasil resvg ±3% lebih besar
    // dari hasil pengukuran opentype.js.
    maxWidth: (THUMBNAIL_WIDTH - TITLE_MARGIN_X * 2) * 0.95,
    maxLines: 3,
    maxFontSize: 60,
    minFontSize: 36,
    maxCharsPerLine: 24,
    measure: measureTitleWidth,
  });

  const lastBaseline = TITLE_LAST_BASELINE;
  const firstBaseline = lastBaseline - (fitted.lines.length - 1) * fitted.lineHeight;
  const accentTop = firstBaseline - Math.round(fitted.fontSize * 0.95) - 26;
  const scrimTop = clamp(accentTop - 96, 700, 1120);

  const { handle, host: hostLabel } = watermarkLabel(baseHandle, host);
  const pills = buildFooterPills(handle, hostLabel);

  return { fitted, firstBaseline, lastBaseline, scrimTop, accentTop, pills };
}

/**
 * Dua pill footer. Pill URL mempertahankan lebar alaminya (selalu terbaca
 * utuh); sisa ruang dipakai pill handle, dan hanya handle yang dipotong dengan
 * elipsis bila terlalu panjang.
 */
function buildFooterPills(handle: string, host: string): FooterPill[] {
  const available = THUMBNAIL_WIDTH - TITLE_MARGIN_X * 2;
  const naturalHandle =
    Math.ceil(measureFontWidth('sans', 600, handle, HANDLE_FONT_SIZE)) + HANDLE_PADDING * 2;
  const naturalHost =
    Math.ceil(measureFontWidth('mono', 400, host, HOST_FONT_SIZE)) + HOST_PADDING * 2;

  // URL platform tidak boleh terpotong: batasi maksimal 45% lebar kanvas.
  let hostWidth = Math.min(naturalHost, Math.round(available * 0.45));
  // Handle dapat sisa ruang, maksimal selebar teks aslinya.
  let handleWidth = Math.min(naturalHandle, available - PILL_GAP - hostWidth);
  // Jaga handle tetap terbaca (minimal 200 px); URL yang mengalah bila perlu.
  if (handleWidth < 200) {
    handleWidth = 200;
    hostWidth = available - PILL_GAP - handleWidth;
  }

  const handleText = fitTextToWidth(
    handle,
    HANDLE_FONT_SIZE,
    handleWidth - HANDLE_PADDING * 2,
    (text, size) => measureFontWidth('sans', 600, text, size)
  );
  const hostText = fitTextToWidth(
    host,
    HOST_FONT_SIZE,
    hostWidth - HOST_PADDING * 2,
    (text, size) => measureFontWidth('mono', 400, text, size)
  );

  const radius = PILL_HEIGHT / 2;
  const rightEdge = THUMBNAIL_WIDTH - TITLE_MARGIN_X;

  return [
    {
      x: TITLE_MARGIN_X,
      y: PILL_TOP,
      width: handleWidth,
      height: PILL_HEIGHT,
      radius,
      text: handleText,
      fontSize: HANDLE_FONT_SIZE,
      fontFamily: 'Poppins, sans-serif',
      fontWeight: 600,
      textX: TITLE_MARGIN_X + HANDLE_PADDING,
      textBaseline: PILL_TOP + Math.round(PILL_HEIGHT / 2 + HANDLE_FONT_SIZE * 0.35),
      textAnchor: 'start',
      stroke: 0.5,
    },
    {
      x: rightEdge - hostWidth,
      y: PILL_TOP,
      width: hostWidth,
      height: PILL_HEIGHT,
      radius,
      text: hostText,
      fontSize: HOST_FONT_SIZE,
      fontFamily: 'Fira Mono, monospace',
      fontWeight: 400,
      textX: rightEdge - HOST_PADDING,
      textBaseline: PILL_TOP + Math.round(PILL_HEIGHT / 2 + HOST_FONT_SIZE * 0.35),
      textAnchor: 'end',
      stroke: 0.3,
    },
  ];
}

/** Warna merek: warna template/base bila valid, lalu palet foto, lalu biru merek. */
function resolveBrandColor(baseColor: unknown, dominant: string | null): string {
  const fromBase = String(baseColor ?? '').trim();
  if (parseHex(fromBase)) return fromBase;
  if (dominant && parseHex(dominant)) return dominant;
  return BRAND_FALLBACK;
}

// ── SVG teks (transparan, di atas foto) ────────────────────────────────────

/**
 * Overlay teks di atas foto penuh: scrim gelap hanya di area bawah supaya
 * foto tetap terlihat utuh, lalu judul kecil + handle base.
 */
function buildOverlaySvg(input: { layout: CoverLayout; brand: string }): string {
  const { layout } = input;
  const accent = mixHex(input.brand, '#ffffff', 0.5);

  const titleLines = layout.fitted.lines
    .map(
      (line, index) =>
        `<text x="${TITLE_MARGIN_X}" y="${layout.firstBaseline + index * layout.fitted.lineHeight}" ` +
        `font-family="Poppins, sans-serif" font-size="${layout.fitted.fontSize}" font-weight="800" ` +
        `fill="#ffffff" letter-spacing="-0.5">${escapeXml(line.toLocaleUpperCase('id-ID'))}</text>`
    )
    .join('');

  const pills = layout.pills
    .map(
      (pill) =>
        `<rect x="${pill.x}" y="${pill.y}" width="${pill.width}" height="${pill.height}" rx="${pill.radius}" ` +
        `fill="${rgba(NIGHT, 0.34)}" stroke="${rgba('#ffffff', pill.stroke)}" stroke-width="1.5"/>` +
        `<text x="${pill.textX}" y="${pill.textBaseline}" text-anchor="${pill.textAnchor}" ` +
        `font-family="${pill.fontFamily}" font-size="${pill.fontSize}" font-weight="${pill.fontWeight}" ` +
        `fill="${rgba('#ffffff', pill.fontWeight >= 600 ? 0.96 : 0.78)}">${escapeXml(pill.text)}</text>`
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMBNAIL_WIDTH}" height="${THUMBNAIL_HEIGHT}" viewBox="0 0 ${THUMBNAIL_WIDTH} ${THUMBNAIL_HEIGHT}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${NIGHT}" stop-opacity="0"/>
      <stop offset="0.55" stop-color="${NIGHT}" stop-opacity="0.62"/>
      <stop offset="1" stop-color="${NIGHT}" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <rect y="${layout.scrimTop}" width="${THUMBNAIL_WIDTH}" height="${THUMBNAIL_HEIGHT - layout.scrimTop}" fill="url(#scrim)"/>
  <rect x="${TITLE_MARGIN_X}" y="${layout.accentTop}" width="96" height="5" rx="2.5" fill="${rgba(accent, 0.95)}"/>
  ${titleLines}
  ${pills}
</svg>`;
}

// ── Render SVG overlay (font bundled) ─────────────────────────────────────

/**
 * Render overlay SVG → PNG dengan font bundled (lihat `svg-render.util`).
 *
 * Penting: `sharp().composite()` merender SVG memakai font sistem, sehingga di
 * Vercel (Linux, tanpa Poppins) hasilnya berbeda. resvg dengan `fonts/` yang
 * sama dengan kartu memastikan tipografi konsisten lokal ↔ produksi.
 */
const renderOverlayPng = renderSvgToPng;

// ── Pengukuran teks ────────────────────────────────────────────────────────

const fontCache = new Map<string, opentype.Font | null>();

/** Lebar teks memakai font bundled; fallback rasio bila font tidak tersedia. */
function measureFontWidth(
  family: 'sans' | 'mono',
  weight: number,
  text: string,
  fontSize: number
): number {
  const key = `${family}:${weight}`;
  if (!fontCache.has(key)) {
    const file = getFontFileFor(family, weight);
    let font: opentype.Font | null = null;
    if (file) {
      try {
        font = opentype.parse(fs.readFileSync(file) as unknown as ArrayBuffer);
      } catch {
        font = null;
      }
    }
    fontCache.set(key, font);
  }
  const font = fontCache.get(key);
  const ratio = family === 'mono' ? 0.6 : 0.56;
  if (!font) return text.length * fontSize * ratio;
  try {
    return font.getAdvanceWidth(text, fontSize, { kerning: true });
  } catch {
    return text.length * fontSize * ratio;
  }
}

function measureTitleWidth(text: string, fontSize: number): number {
  return measureFontWidth('sans', 800, text, fontSize);
}

/** Potong teks dengan elipsis sampai muat di lebar tertentu. */
function fitTextToWidth(
  text: string,
  fontSize: number,
  maxWidth: number,
  measure: (text: string, size: number) => number
): string {
  const limit = Math.max(0, maxWidth);
  if (measure(text, fontSize) <= limit) return text;
  let value = text;
  while (value.length > 1 && measure(`${value}…`, fontSize) > limit) {
    value = value.slice(0, -1).trimEnd();
  }
  return `${value}…`;
}

// ── Helper kecil ───────────────────────────────────────────────────────────

function withVersion(url: string, version: number): string {
  if (!version) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${version}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function escapeXml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function persistThumbnailState(fessId: string, data: Record<string, any>): Promise<void> {
  try {
    await prisma.fess.update({ where: { id: fessId }, data });
  } catch (err: any) {
    console.warn('[Thumbnail] Gagal menyimpan status:', err?.message || err);
  }
}

async function logThumbnail(tone: 'ok' | 'muted' | 'error', message: string): Promise<void> {
  try {
    await prisma.systemLog.create({
      data: { source: 'THUMBNAIL', tone, message: clip(message, 500) },
    });
  } catch {
    /* logging tidak boleh menggagalkan publish */
  }
}