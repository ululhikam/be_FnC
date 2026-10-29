/**
 * Thumbnail cover Instagram (slide indeks 0).
 *
 * Komposisi dua zona (bukan foto full-bleed):
 *   • pita judul di atas — warna dari template/base (fallback palet foto),
 *   • foto user utuh di bawah — `contain`, sisa ruang diisi salinan foto blur,
 *   • pita watermark di paling bawah — handle base + host frontend.
 *
 * Foto tidak pernah ditutup judul atau diblur seluruhnya: hanya letterbox di
 * sekeliling foto yang memakai salinan blur supaya bingkai tidak putih polos.
 *
 * Judul: dibuat AI (P2) bila base memakai mode `auto` dan AI aktif; selain itu
 * `fallbackTitle()` deterministik. Judul bersifat final — tidak bisa diedit.
 */
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import opentype from 'opentype.js';
import fs from 'fs';
import { ENV } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { getFontFileFor, getFontFiles } from '../config/fonts.js';
import { StorageService } from './storage.service.js';
import { AiService } from './ai/ai.service.js';
import { fetchRemoteImage } from '../utils/remote-image.util.js';
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
  pickInkColor,
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
/** Ukuran font label base di atas judul (px). */
const LABEL_SIZE = 24;
const LABEL_BASELINE = 112;
/** Awal kotak judul (di bawah garis aksen + label). */
const TITLE_TOP = 142;
/** Pita watermark bawah: handle base + host frontend. */
const FOOTER_HEIGHT = 132;
const PHOTO_BOTTOM = THUMBNAIL_HEIGHT - FOOTER_HEIGHT;
/** Tinggi pita judul dijepit agar foto selalu kebagian ruang yang layak. */
const TITLE_BAND_MIN = 356;
const TITLE_BAND_MAX = 588;
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
    const layout = buildCoverLayout(title);

    // Foto utama TIDAK di-crop dan TIDAK diblur: di-contain utuh di zona bawah.
    // Salinan blur hanya mengisi letterbox di sekelilingnya agar bingkai tetap
    // mengikuti warna foto (bukan putih polos).
    const source = sharp(photo, { failOn: 'none' }).rotate();
    const backdrop = await source
      .clone()
      .resize(THUMBNAIL_WIDTH, layout.photoHeight, { fit: 'cover', position: 'centre' })
      .blur(40)
      .modulate({ brightness: 0.82, saturation: 1.08 })
      .removeAlpha()
      .toBuffer();
    const foreground = await source
      .clone()
      .resize({
        width: THUMBNAIL_WIDTH,
        height: layout.photoHeight,
        fit: 'contain',
        position: 'centre',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    const frame = renderOverlayPng(buildFrameSvg(layout, brand));
    const text = renderOverlayPng(
      buildOverlaySvg({
        layout,
        brand,
        baseName: input.base?.name || input.baseHandle,
        baseHandle: input.baseHandle,
      })
    );

    const buffer = await sharp(frame)
      .composite([
        { input: backdrop, top: layout.photoTop, left: 0 },
        { input: foreground, top: layout.photoTop, left: 0 },
        { input: text, top: 0, left: 0 },
      ])
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

// ── Tata letak dua zona ────────────────────────────────────────────────────

interface CoverLayout {
  fitted: FittedTitle;
  /** Tinggi pita judul di atas. */
  titleBandHeight: number;
  /** Awal zona foto (tepat di bawah pita judul). */
  photoTop: number;
  /** Tinggi zona foto yang tersedia untuk foto utuh. */
  photoHeight: number;
  /** Awal pita watermark bawah. */
  footerTop: number;
  /** Baseline baris pertama judul. */
  firstBaseline: number;
}

/**
 * Hitung tata letak dari hasil auto-fit judul. Tinggi pita judul mengikuti
 * jumlah baris, sehingga sisa kanvas untuk foto selalu maksimal.
 */
function buildCoverLayout(title: string): CoverLayout {
  const fitted = fitTitle(title, {
    // Faktor 0.95 memberi ruang aman: lebar glyph hasil resvg ±3% lebih besar
    // dari hasil pengukuran opentype.js.
    maxWidth: (THUMBNAIL_WIDTH - TITLE_MARGIN_X * 2) * 0.95,
    maxLines: 3,
    maxFontSize: 84,
    minFontSize: 40,
    maxCharsPerLine: 20,
    measure: measureTitleWidth,
  });

  const firstBaseline = TITLE_TOP + Math.round(fitted.fontSize * 0.8);
  const lastBaseline = firstBaseline + (fitted.lines.length - 1) * fitted.lineHeight;
  const titleBandHeight = clamp(
    lastBaseline + Math.round(fitted.fontSize * 0.3) + 48,
    TITLE_BAND_MIN,
    TITLE_BAND_MAX
  );

  return {
    fitted,
    titleBandHeight,
    photoTop: titleBandHeight,
    photoHeight: PHOTO_BOTTOM - titleBandHeight,
    footerTop: PHOTO_BOTTOM,
    firstBaseline,
  };
}

/** Warna merek: warna template/base bila valid, lalu palet foto, lalu biru merek. */
function resolveBrandColor(baseColor: unknown, dominant: string | null): string {
  const fromBase = String(baseColor ?? '').trim();
  if (parseHex(fromBase)) return fromBase;
  if (dominant && parseHex(dominant)) return dominant;
  return BRAND_FALLBACK;
}

/** Latar kanvas: pita judul (warna template) + pita watermark, tanpa foto. */
function buildFrameSvg(layout: CoverLayout, brand: string): string {
  const bandTop = mixHex(brand, NIGHT, 0.55);
  const bandBottom = mixHex(brand, NIGHT, 0.8);
  const footer = mixHex(brand, NIGHT, 0.88);
  const accent = mixHex(brand, '#ffffff', 0.55);
  const ringCy = Math.max(140, layout.titleBandHeight - 96);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMBNAIL_WIDTH}" height="${THUMBNAIL_HEIGHT}" viewBox="0 0 ${THUMBNAIL_WIDTH} ${THUMBNAIL_HEIGHT}">
  <defs>
    <linearGradient id="titleBand" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="${bandTop}"/>
      <stop offset="1" stop-color="${bandBottom}"/>
    </linearGradient>
  </defs>
  <rect width="${THUMBNAIL_WIDTH}" height="${THUMBNAIL_HEIGHT}" fill="${footer}"/>
  <rect width="${THUMBNAIL_WIDTH}" height="${layout.titleBandHeight}" fill="url(#titleBand)"/>
  <rect y="${layout.footerTop}" width="${THUMBNAIL_WIDTH}" height="${FOOTER_HEIGHT}" fill="${footer}"/>
  <rect y="${layout.titleBandHeight - 3}" width="${THUMBNAIL_WIDTH}" height="3" fill="${rgba(accent, 0.55)}"/>
  <circle cx="1016" cy="${ringCy}" r="150" fill="none" stroke="${rgba(accent, 0.2)}" stroke-width="2"/>
  <line x1="${TITLE_MARGIN_X}" y1="62" x2="${TITLE_MARGIN_X + 164}" y2="62" stroke="${rgba(accent, 0.9)}" stroke-width="6" stroke-linecap="round"/>
</svg>`;
}

// ── SVG teks (transparan, di atas foto) ────────────────────────────────────

function buildOverlaySvg(input: {
  layout: CoverLayout;
  brand: string;
  baseName?: string | null;
  baseHandle: string;
}): string {
  const { layout } = input;
  // Warna teks dihitung dari pita judul (warna solid), bukan dari foto, supaya
  // kontras judul selalu terjamin tanpa perlu plat semi-transparan.
  const bandBottom = mixHex(input.brand, NIGHT, 0.8);
  const footer = mixHex(input.brand, NIGHT, 0.88);
  const ink = pickInkColor(bandBottom);
  const footerInk = pickInkColor(footer);
  const accent = mixHex(input.brand, '#ffffff', 0.55);

  const { handle } = watermarkLabel(input.baseHandle);
  const baseLabel = escapeXml(String(input.baseName || input.baseHandle || '').toUpperCase());
  const titleLines = layout.fitted.lines
    .map(
      (line, index) =>
        `<text x="${TITLE_MARGIN_X}" y="${layout.firstBaseline + index * layout.fitted.lineHeight}" ` +
        `font-family="Poppins, sans-serif" font-size="${layout.fitted.fontSize}" font-weight="800" ` +
        `fill="${ink}" letter-spacing="-1">${escapeXml(line.toLocaleUpperCase('id-ID'))}</text>`
    )
    .join('');
  const footerBaseline = layout.footerTop + 84;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMBNAIL_WIDTH}" height="${THUMBNAIL_HEIGHT}" viewBox="0 0 ${THUMBNAIL_WIDTH} ${THUMBNAIL_HEIGHT}">
  <text x="${TITLE_MARGIN_X}" y="${LABEL_BASELINE}" font-family="Poppins, sans-serif" font-size="${LABEL_SIZE}" font-weight="600" letter-spacing="4" fill="${rgba(ink, 0.8)}">${baseLabel}</text>
  ${titleLines}
  <circle cx="${TITLE_MARGIN_X + 6}" cy="${footerBaseline - 12}" r="6" fill="${rgba(accent, 0.9)}"/>
  <text x="${TITLE_MARGIN_X + 26}" y="${footerBaseline}" font-family="Poppins, sans-serif" font-size="36" font-weight="700" fill="${rgba(footerInk, 0.96)}">${escapeXml(handle)}</text>
</svg>`;
}

// ── Render SVG overlay (font bundled) ─────────────────────────────────────

/**
 * Render overlay SVG → PNG dengan font bundled.
 *
 * Penting: `sharp().composite()` merender SVG memakai font sistem, sehingga di
 * Vercel (Linux, tanpa Poppins) hasilnya berbeda. resvg dengan `fonts/` yang
 * sama dengan kartu memastikan tipografi konsisten lokal ↔ produksi.
 */
function renderOverlayPng(svg: string): Buffer {
  const fontFiles = getFontFiles();
  const resvg = new Resvg(svg, {
    font: fontFiles.length
      ? { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Poppins' }
      : { defaultFontFamily: 'Poppins' },
  });
  return Buffer.from(resvg.render().asPng());
}

// ── Pengukuran teks ────────────────────────────────────────────────────────

const fontCache = new Map<string, opentype.Font | null>();

function measureTitleWidth(text: string, fontSize: number): number {
  const key = 'sans:800';
  if (!fontCache.has(key)) {
    const file = getFontFileFor('sans', 800);
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
  if (!font) return text.length * fontSize * 0.56;
  try {
    return font.getAdvanceWidth(text, fontSize, { kerning: true });
  } catch {
    return text.length * fontSize * 0.56;
  }
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