/**
 * Thumbnail cover Instagram (slide indeks 0).
 *
 * Komposisi: foto user (cover-crop + blur) → gradien dari palet foto → judul
 * → watermark handle base + host frontend. Dirender saat publish (bukan saat
 * upload) supaya isi fess final yang dipakai dan retry worker konsisten.
 *
 * Fase P1: judul deterministik (`fallbackTitle`) tanpa panggilan AI. P2 akan
 * mengganti sumber judul tanpa mengubah renderer.
 */
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import opentype from 'opentype.js';
import fs from 'fs';
import { ENV } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { getFontFileFor, getFontFiles } from '../config/fonts.js';
import { StorageService } from './storage.service.js';
import { fetchRemoteImage } from '../utils/remote-image.util.js';
import {
  THUMBNAIL_HEIGHT,
  THUMBNAIL_WIDTH,
  allocateCarouselSlots,
  buildGradientStops,
  darkenHex,
  dominantColor,
  fallbackTitle,
  fitTitle,
  isThumbnailModeAllowed,
  mixHex,
  meanGammaLuminance,
  panelAlphaForLuminance,
  pickInkColor,
  rgba,
  selectCoverMedia,
  watermarkLabel,
  type CarouselSlotPlan,
} from '../utils/thumbnail.util.js';

export const THUMBNAIL_PROMPT_VERSION = 'fallback';
const TITLE_MARGIN_X = 72;
const WATERMARK_Y = 1282;
const TITLE_MIN_TOP = 196;
const TITLE_MAX_BOTTOM = 1180;
/** Ukuran font label base di atas judul (px). */
const LABEL_SIZE = 24;

export interface ThumbnailFessInput {
  id: string;
  content: string;
  baseHandle: string;
  media?: unknown;
  base?: { name?: string | null; thumbnailMode?: string | null; color?: string | null } | null;
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
          thumbnailPromptVersion: THUMBNAIL_PROMPT_VERSION,
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
    const { buffer: photo } = await fetchRemoteImage(photoUrl, {
      maxBytes: ENV.THUMBNAIL_MAX_MEDIA_FETCH_BYTES,
      timeoutMs: ENV.THUMBNAIL_FETCH_TIMEOUT_MS,
    });

    // Palet dihitung dari foto kecil (deterministik, murah) sebelum blur.
    const palettePixels = await sharp(photo, { failOn: 'none' })
      .rotate()
      .resize(24, 30, { fit: 'cover', position: 'top' })
      .removeAlpha()
      .raw()
      .toBuffer();
    const dominant = dominantColor(palettePixels);

    const background = await sharp(photo, { failOn: 'none' })
      .rotate()
      .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, { fit: 'cover', position: 'top' })
      .blur(28)
      .modulate({ brightness: 0.72, saturation: 1.05 })
      .jpeg({ quality: 92 })
      .toBuffer();

    // Kecerahan foto di area judul menentukan kekuatan plat judul. Diukur pada
    // pita 25%–75% tinggi karena judul selalu berada di rentang itu. Catatan:
    // `sharp().stats()` mengabaikan operasi pipeline, jadi piksel diambil
    // eksplisit lalu dirata-rata.
    const luminancePixels = await sharp(background)
      .extract({
        left: Math.round(THUMBNAIL_WIDTH * 0.06),
        top: Math.round(THUMBNAIL_HEIGHT * 0.25),
        width: Math.round(THUMBNAIL_WIDTH * 0.88),
        height: Math.round(THUMBNAIL_HEIGHT * 0.5),
      })
      .resize(24, 16, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();
    const panelAlpha = panelAlphaForLuminance(meanGammaLuminance(luminancePixels));

    const title = fallbackTitle(input.content);
    const overlay = buildOverlaySvg({
      title,
      baseName: input.base?.name || input.baseHandle,
      baseHandle: input.baseHandle,
      dominant,
      panelAlpha,
    });

    const buffer = await sharp(background)
      .composite([{ input: renderOverlayPng(overlay), top: 0, left: 0 }])
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();

    return { buffer, dominant, title };
  }
}

// ── SVG komposisi ──────────────────────────────────────────────────────────

function buildOverlaySvg(input: {
  title: string;
  baseName?: string | null;
  baseHandle: string;
  dominant: string | null;
  /** Kekuatan plat di belakang judul (dihitung dari kecerahan foto). */
  panelAlpha: number;
}): string {
  const stops = buildGradientStops(input.dominant);
  const tone = stops[stops.length - 1].color;
  const accent = mixHex(input.dominant || '#0055ff', '#ffffff', 0.55);
  const titleInk = pickInkColor(mixHex(tone, '#000000', 0.55));

  const fitted = fitTitle(input.title, {
    // Faktor 0.95 memberi ruang aman: lebar glyph hasil resvg ±3% lebih besar
    // dari hasil pengukuran opentype.js.
    maxWidth: (THUMBNAIL_WIDTH - TITLE_MARGIN_X * 2) * 0.95,
    maxLines: 4,
    maxFontSize: 92,
    minFontSize: 44,
    maxCharsPerLine: 20,
    measure: measureTitleWidth,
  });

  const blockHeight = fitted.lines.length * fitted.lineHeight;
  const preferredTop = Math.round((THUMBNAIL_HEIGHT - blockHeight) / 2 + 40);
  const titleTop = clamp(preferredTop, TITLE_MIN_TOP, TITLE_MAX_BOTTOM - blockHeight);
  // Baseline label harus berada di atas ascender baris pertama (≈0.78 × font).
  const labelY = titleTop - Math.round(fitted.fontSize * 0.92);

  // Panel mengikuti blok teks (label + judul) supaya tidak menyisakan ruang
  // gelap kosong di bawah judul pendek.
  const lastBaseline = titleTop + (fitted.lines.length - 1) * fitted.lineHeight;
  const panelTop = Math.max(28, labelY - LABEL_SIZE - 26);
  const panelBottom = lastBaseline + Math.round(fitted.fontSize * 0.28) + 30;
  const panelHeight = panelBottom - panelTop;

  const { handle, host } = watermarkLabel(input.baseHandle, frontendHost());
  const baseLabel = escapeXml(String(input.baseName || input.baseHandle || '').toUpperCase());
  const titleLines = fitted.lines
    .map(
      (line, index) =>
        `<text x="${TITLE_MARGIN_X}" y="${titleTop + index * fitted.lineHeight}" ` +
        `font-family="Poppins, sans-serif" font-size="${fitted.fontSize}" font-weight="800" ` +
        `fill="${titleInk}" letter-spacing="-1">${escapeXml(line.toLocaleUpperCase('id-ID'))}</text>`
    )
    .join('');

  const gradient = stops
    .map((stop) => `<stop offset="${stop.offset}" stop-color="${stop.color}" stop-opacity="${stop.alpha}"/>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMBNAIL_WIDTH}" height="${THUMBNAIL_HEIGHT}" viewBox="0 0 ${THUMBNAIL_WIDTH} ${THUMBNAIL_HEIGHT}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">${gradient}</linearGradient>
  </defs>
  <rect width="${THUMBNAIL_WIDTH}" height="${THUMBNAIL_HEIGHT}" fill="url(#scrim)"/>
  <rect x="${TITLE_MARGIN_X - 24}" y="${panelTop}" width="${THUMBNAIL_WIDTH - (TITLE_MARGIN_X - 24) * 2}" height="${panelHeight}" rx="36" fill="${rgba(mixHex(darkenHex(tone, 0.5), '#05070c', 0.55), input.panelAlpha)}" stroke="${rgba('#ffffff', 0.12)}" stroke-width="1"/>
  <circle cx="${THUMBNAIL_WIDTH - 236}" cy="236" r="178" fill="none" stroke="${rgba(accent, 0.28)}" stroke-width="2"/>
  <line x1="${TITLE_MARGIN_X}" y1="152" x2="${TITLE_MARGIN_X + 168}" y2="152" stroke="${rgba(accent, 0.6)}" stroke-width="6" stroke-linecap="round"/>
  <text x="${TITLE_MARGIN_X}" y="${labelY}" font-family="Poppins, sans-serif" font-size="${LABEL_SIZE}" font-weight="600" letter-spacing="4" fill="${rgba(titleInk, 0.82)}">${baseLabel}</text>
  ${titleLines}
  <text x="${TITLE_MARGIN_X}" y="${WATERMARK_Y}" font-family="Poppins, sans-serif" font-size="34" font-weight="600" fill="${rgba(titleInk, 0.94)}">${escapeXml(handle)}</text>
  <text x="${THUMBNAIL_WIDTH - TITLE_MARGIN_X}" y="${WATERMARK_Y}" text-anchor="end" font-family="Fira Mono, monospace" font-size="25" fill="${rgba(titleInk, 0.78)}">${escapeXml(host)}</text>
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

function frontendHost(): string {
  const raw = String(ENV.FRONTEND_URL || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).host;
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
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