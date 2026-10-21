import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import opentype from 'opentype.js';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import {
  ASPECTS,
  getTemplateByKey,
  type TemplateConfig,
  type TemplateTypography,
} from '../constants/templates.js';
import { StorageService } from './storage.service.js';
import { prisma } from '../config/prisma.js';
import { InstagramService } from './instagram.service.js';
import {
  getFontFiles,
  getFontFileFor,
  getFontCssStack,
  type FontFamilyKey,
} from '../config/fonts.js';
import { getEmojiSvgMarkup } from '../config/emoji.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Template generasi lama (solid, tanpa gradient). Dipertahankan agar fess lama
 * tetap bisa dirender: warna solid per key, tekstur halus, dan panel kartu
 * versi lama.
 */
const LEGACY_TEMPLATE_KEYS = new Set([
  'default',
  'midnight',
  'sunset',
  'forest',
  'noir',
  'paper',
  'ocean',
  'violet',
]);

/**
 * Tekstur template generasi lama — kembar dengan helper `texture` pada
 * frontend/src/config/templates.js supaya pratinjau dan hasil render sama.
 */
const LEGACY_PATTERNS: Record<string, string> = {
  default: `<pattern id="bgPattern" width="28" height="28" patternUnits="userSpaceOnUse">
        <circle cx="7" cy="7" r="1.6" fill="rgba(255,255,255,0.16)"/>
      </pattern>`,
  midnight: `<pattern id="bgPattern" width="34" height="34" patternUnits="userSpaceOnUse">
        <circle cx="8.5" cy="8.5" r="1.2" fill="rgba(255,255,255,0.30)"/>
      </pattern>`,
  sunset: `<pattern id="bgPattern" width="18" height="18" patternUnits="userSpaceOnUse">
        <path d="M-18,0 l36,36 M0,-18 l36,36 M18,36 l36,36" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>
      </pattern>`,
  forest: `<pattern id="bgPattern" width="60" height="60" patternUnits="userSpaceOnUse">
        <circle cx="7" cy="11" r="1.5" fill="rgba(255,255,255,0.22)"/>
        <circle cx="31" cy="6" r="1.1" fill="rgba(255,255,255,0.22)"/>
        <circle cx="46" cy="24" r="1.7" fill="rgba(255,255,255,0.22)"/>
        <circle cx="19" cy="38" r="1.2" fill="rgba(255,255,255,0.22)"/>
        <circle cx="52" cy="49" r="1.4" fill="rgba(255,255,255,0.22)"/>
        <circle cx="34" cy="53" r="1" fill="rgba(255,255,255,0.22)"/>
      </pattern>`,
  noir: `<pattern id="bgPattern" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M40 0H0v40" fill="none" stroke="rgba(0,56,255,0.35)" stroke-width="1"/>
      </pattern>`,
  paper: `<pattern id="bgPattern" width="16" height="16" patternUnits="userSpaceOnUse">
        <path d="M-16,0 l32,32 M0,-16 l32,32 M16,32 l32,32" fill="none" stroke="rgba(60,40,20,0.10)" stroke-width="2"/>
      </pattern>`,
  ocean: `<pattern id="bgPattern" width="64" height="24" patternUnits="userSpaceOnUse">
        <path d="M0 12q8-8 16 0t16 0 16 0 16 0" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2"/>
      </pattern>`,
  violet: `<pattern id="bgPattern" width="90" height="90" patternUnits="userSpaceOnUse">
        <circle cx="45" cy="45" r="18" fill="none" stroke="rgba(255,255,255,0.16)"/>
        <circle cx="45" cy="45" r="34" fill="none" stroke="rgba(255,255,255,0.16)"/>
      </pattern>`,
};

export interface CanvasExportResult {
  image_url: string;
  image_urls: string[];
  card_count: number;
  media_count: number;
  posted_to: ('instagram' | 'twitter' | 'telegram')[];
  ig_result?: any;
}

export interface CanvasExportOptions {
  /** false = hanya render/upload card, jangan auto-post ke Instagram. */
  autoPost?: boolean;
}

/** Bentuk minimal data fess yang dibutuhkan builder SVG (mudah di-test tanpa DB). */
export interface FessLike {
  id?: string;
  content: string;
  baseHandle: string;
  tag?: string | null;
  template?: string | null;
  quotedFess?: any;
  base?: {
    name?: string | null;
    initial?: string | null;
    igAccount?: string | null;
  } | null;
}

/** Satu potongan teks atau satu emoji dalam satu baris. */
interface TextSegment {
  kind: 'text' | 'emoji';
  text: string;
  width: number;
  svg?: string;
}

type TextLine = TextSegment[];
type TextPage = TextLine[];

/** Tipografi default — dipakai template lama yang belum punya konfigurasi. */
const DEFAULT_TYPOGRAPHY: TemplateTypography = {
  family: 'sans',
  weight: 600,
  uppercase: false,
  align: 'left',
  letterSpacing: 0,
  lineHeight: 1.42,
  scale: 1,
};

/** Gabungkan konfigurasi tipografi template dengan default yang aman. */
function resolveTypography(template: TemplateConfig): TemplateTypography {
  return { ...DEFAULT_TYPOGRAPHY, ...(template.typography || {}) };
}

const SOFT_SHADOW =
  '<feDropShadow dx="0" dy="18" stdDeviation="28" flood-color="#000000" flood-opacity="0.25"/>';
const HARD_SHADOW =
  '<feDropShadow dx="12" dy="12" stdDeviation="0" flood-color="#000000" flood-opacity="1"/>';

const MAX_PAGES = 10; // batas carousel Instagram
const MAX_QUOTE_LINES = 4;

export class CanvasService {
  /**
   * Simpan status IG tanpa menggagalkan alur utama. Aman untuk unit test yang
   * memakai mock Prisma sederhana (update bisa tidak mengembalikan Promise).
   */
  private static async persistIgState(fessId: string, data: Record<string, any>): Promise<void> {
    try {
      await prisma.fess.update({
        where: { id: fessId },
        data: { ...data, igUpdatedAt: new Date() },
      });
    } catch (err: any) {
      console.warn('[Canvas] Gagal menyimpan status IG:', err?.message || err);
    }
  }

  /**
   * Render confession card → PNG/JPEG (satu atau beberapa halaman carousel)
   * → upload ke Supabase → auto-post ke Instagram Feed.
   *
   * Semua template sekarang 4:5. aspectKey eksplisit dipertahankan hanya untuk
   * export admin (mis. story); posting Instagram selalu memakai portrait.
   */
  static async exportFessCanvas(
    fessId: string,
    templateKey = 'default',
    aspectKey = '',
    options: CanvasExportOptions = {}
  ): Promise<CanvasExportResult> {
    try {
      return await CanvasService.exportFessCanvasUnsafe(fessId, templateKey, aspectKey, options);
    } catch (err: any) {
      // Render/upload gagal sebelum sempat memanggil InstagramService — tetap
      // simpan alasan agar admin melihat status yang jelas di UI. Ekspor khusus
      // non-portrait (mis. story) atau ekspor tanpa auto-post tidak boleh
      // mengubah status Instagram.
      const wantsPortrait = (ASPECTS[aspectKey] || ASPECTS.portrait).key === 'portrait';
      if (wantsPortrait && options.autoPost !== false) {
        await CanvasService.persistIgState(fessId, {
          igStatus: 'failed',
          igError: clipIgError(`Render/publikasi Instagram gagal: ${err?.message || err}`),
        });
      }
      throw err;
    }
  }

  private static async exportFessCanvasUnsafe(
    fessId: string,
    templateKey = 'default',
    aspectKey = '',
    options: CanvasExportOptions = {}
  ): Promise<CanvasExportResult> {
    const fess = await prisma.fess.findUnique({
      where: { id: fessId },
      include: { base: true },
    });

    if (!fess) {
      throw new Error('Fess tidak ditemukan');
    }

    // Semua template sekarang 4:5. aspectKey eksplisit hanya dipakai fitur
    // export admin (mis. story/9:16); default selalu portrait 4:5.
    const template = getTemplateByKey(templateKey || fess.template || 'default');
    const aspect = ASPECTS[aspectKey] || ASPECTS.portrait;
    // Hanya render 4:5 dan fess yang belum pernah terbit ke IG yang boleh
    // auto-post. Ekspor non-portrait/ekspor admin murni untuk unduhan.
    const publishToIg =
      aspect.key === 'portrait' && options.autoPost !== false && !(fess as any).postedToIg;

    const svgs = CanvasService.buildSvgPages(fess as unknown as FessLike, templateKey, aspectKey);

    // ── SVG → JPEG (resvg + sharp, font bundled) → upload per halaman ──────
    // Instagram Content Publishing hanya menerima gambar JPEG.
    const imageUrls: string[] = [];
    for (let i = 0; i < svgs.length; i++) {
      const jpeg = await CanvasService.renderSvgToJpeg(svgs[i]);
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: `canvas_${fessId}_${template.key}_${aspect.key}_p${i + 1}.jpg`,
        encoding: '7bit',
        mimetype: 'image/jpeg',
        size: jpeg.length,
        buffer: jpeg,
        destination: '',
        filename: '',
        path: '',
        stream: null as any,
      };
      const upload = await StorageService.uploadMedia(mockFile, 'canvas-exports');
      imageUrls.push(upload.url);
    }

    // ── Auto-post ke Instagram Feed (card + media user) ────────────────────
    const posted_to: ('instagram' | 'twitter' | 'telegram')[] = [];
    let ig_result: any = null;

    // Media user (gambar/video) ikut diposting. Sisakan slot untuk card agar
    // media tetap kebagian (maksimal 10 item carousel Instagram).
    const mediaItems = collectMediaItems(fess.media);
    const cardItems = imageUrls
      .slice(0, Math.max(1, 10 - mediaItems.length))
      .map((url) => ({
        type: 'image' as const,
        url,
        width: aspect.width,
        height: aspect.height,
        normalized: true,
      }));
    const postItems = [...cardItems, ...mediaItems].slice(0, 10);

    // Caption = isi fess penuh (pemotongan batas 2200 char ditangani InstagramService).
    const caption = String(fess.content || '');
    const baseIg = (fess as any).base?.igAccount || fess.baseHandle;

    if (publishToIg) {
      // Simpan payload sebelum panggilan Meta agar retry worker punya sumber
      // data yang konsisten walau invocation pertama terputus.
      await CanvasService.persistIgState(fessId, {
        igPayload: {
          baseHandle: fess.baseHandle,
          caption,
          aspect: 'portrait',
          width: 1080,
          height: 1350,
          items: postItems.map((item) => ({
            type: item.type,
            url: item.url,
            width: item.width ?? null,
            height: item.height ?? null,
            duration: (item as any).duration ?? null,
            normalized: Boolean((item as any).normalized),
          })),
        },
        igStatus: 'processing',
        igError: null,
      });

      // Meta Graph API butuh URL publik HTTP(S) — lewati data-URI.
      const hasPublicUrl = imageUrls.some((u) => !u.startsWith('data:'));
      if (hasPublicUrl) {
        try {
          ig_result = await InstagramService.autoPostFess(fess.baseHandle, fess.id, postItems, caption);
          if (ig_result?.meta_published === true) {
            posted_to.push('instagram');
          }
          if (Array.isArray(ig_result?.items) && ig_result.items.length) {
            await CanvasService.persistIgState(fessId, {
              igPayload: {
                baseHandle: fess.baseHandle,
                caption,
                aspect: 'portrait',
                width: 1080,
                height: 1350,
                items: ig_result.items,
              },
            });
          }
        } catch (igErr: any) {
          console.warn('[Canvas] Instagram auto-post failed:', igErr.message);
          await CanvasService.persistIgState(fessId, {
            igStatus: 'failed',
            igError: clipIgError(igErr?.message || 'Auto-post Instagram gagal.'),
          });
        }
      } else {
        const reason =
          'Storage mengembalikan data-URI, bukan URL publik — Instagram tidak dapat mengambil media.';
        console.warn('[Canvas]', reason);
        await CanvasService.persistIgState(fessId, { igStatus: 'failed', igError: reason });
        ig_result = {
          success: false,
          platform: 'instagram',
          meta_published: false,
          ig_pending: false,
          fessId,
          base_ig: baseIg,
          error: reason,
        };
      }
    } else {
      ig_result = {
        success: false,
        platform: 'instagram',
        meta_published: false,
        ig_pending: false,
        skipped: true,
        fessId,
        base_ig: baseIg,
        error: 'Render non-portrait tidak dipublikasikan ke Instagram.',
      };
    }

    // Mark fess as posted (hanya jika benar-benar terbit ke Instagram)
    if (posted_to.includes('instagram')) {
      await prisma.fess.update({
        where: { id: fessId },
        data: { postedToIg: true, igStatus: 'published', igError: null },
      });
    }

    const cardUrls = cardItems.map((c) => c.url);
    return {
      image_url: cardUrls[0] || '',
      image_urls: cardUrls,
      card_count: cardUrls.length,
      media_count: mediaItems.length,
      posted_to,
      ig_result,
    };
  }

  /**
   * Bangun SVG card (1..10 halaman) untuk sebuah fess — murni tanpa DB,
   * dipakai exportFessCanvas() dan skrip verifikasi lokal.
   */
  static buildSvgPages(fess: FessLike, templateKey = 'default', aspectKey = ''): string[] {
    const template = getTemplateByKey(templateKey || fess.template || 'default');
    // Semua template 4:5. Kunci kosong/tak dikenal jatuh ke portrait; kunci
    // eksplisit (mis. story) tetap dihormati untuk export admin.
    const aspect = ASPECTS[aspectKey] || ASPECTS.portrait;

    // ── Visual variables ────────────────────────────────────────────────────
    const baseName = fess.base?.name || fess.baseHandle || 'Confession Base';
    const baseInitial = (
      fess.base?.initial ||
      (fess.baseHandle ? fess.baseHandle.replace(/^@/, '').slice(0, 2) : 'FC')
    ).toUpperCase();
    const baseIg = fess.base?.igAccount
      ? fess.base.igAccount.startsWith('@')
        ? fess.base.igAccount
        : `@${fess.base.igAccount}`
      : fess.baseHandle;

    const isDark = template.ink === 'dark';
    const isNeo = template.key === 'neobrutalism';
    const isLegacy = LEGACY_TEMPLATE_KEYS.has(template.key);
    const typo = resolveTypography(template);

    // 20 template baru punya `panel` + `pattern` sendiri. Thumbnail di modal
    // menampilkan background/tekstur penuh, jadi kartu hasilnya dibuat
    // full-bleed (tanpa panel penutup) dan tekstur diperbesar agar bobot
    // visualnya sama dengan thumbnail.
    const isFullBleed = Boolean(template.panel && template.pattern);
    const FULL_BLEED_PATTERN_SCALE = 5;

    // ── Per-template tailored card styling ─────────────────────────────────
    let textColor = template.textColor || (isDark ? '#1a1a2e' : '#ffffff');
    let subtextColor =
      template.subtextColor || (isDark ? 'rgba(26,26,46,0.7)' : 'rgba(255,255,255,0.75)');
    let cardBg = isDark ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.08)';
    let cardBorder = isDark ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.18)';
    let cardBorderWidth = 2;
    let cardRadius = 36;
    let panelDash = '';
    let cardShadow: 'soft' | 'hard' | 'none' = 'soft';

    if (template.panel) {
      // Template baru: seluruh gaya panel ditentukan dari config.
      cardBg = template.panel.bg;
      cardBorder = template.panel.border;
      cardBorderWidth = template.panel.width ?? 2;
      cardRadius = template.panel.radius ?? 36;
      panelDash = template.panel.dash || '';
      cardShadow = template.panel.shadow || 'soft';
    } else if (template.key === 'neobrutalism') {
      textColor = '#000000';
      subtextColor = 'rgba(0,0,0,0.75)';
      cardBg = '#ffffff';
      cardBorder = '#000000';
      cardBorderWidth = 4;
      cardRadius = 24;
      cardShadow = 'hard';
    } else if (template.key === 'cyberpunk') {
      cardBg = 'rgba(13, 20, 32, 0.94)';
      cardBorder = 'rgba(0, 255, 102, 0.4)';
    } else if (template.key === 'terminal') {
      cardBg = 'rgba(10, 16, 24, 0.94)';
      cardBorder = 'rgba(0, 240, 255, 0.35)';
    } else if (template.key === 'rock') {
      cardBg = 'rgba(22, 22, 22, 0.96)';
      cardBorder = 'rgba(255, 0, 60, 0.35)';
    } else if (template.key === 'acid') {
      cardBg = 'rgba(28, 12, 44, 0.94)';
      cardBorder = 'rgba(204, 255, 0, 0.4)';
    } else if (template.key === 'swiss') {
      textColor = '#111827';
      subtextColor = '#4b5563';
      cardBg = '#ffffff';
      cardBorder = 'rgba(0, 0, 0, 0.12)';
    } else if (template.key === 'monochrome') {
      textColor = '#000000';
      subtextColor = '#374151';
      cardBg = '#ffffff';
      cardBorder = 'rgba(0, 0, 0, 0.35)';
      cardBorderWidth = 3;
    } else if (template.key === 'indie') {
      cardBg = 'rgba(56, 18, 10, 0.65)';
      cardBorder = 'rgba(253, 240, 213, 0.35)';
    } else if (template.key === 'blueprint') {
      cardBg = 'rgba(12, 42, 78, 0.90)';
      cardBorder = 'rgba(72, 202, 228, 0.45)';
    } else if (template.key === 'bubblegum') {
      cardBg = 'rgba(255, 255, 255, 0.18)';
      cardBorder = 'rgba(255, 255, 255, 0.4)';
    } else if (isLegacy) {
      // Panel versi lama: putih transparan tipis di atas warna solid.
      cardBg = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.08)';
      cardBorder = isDark ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.18)';
    }

    const shadowDef = cardShadow === 'hard' ? HARD_SHADOW : SOFT_SHADOW;
    const cardFilter = cardShadow === 'none' ? '' : ' filter="url(#cardShadow)"';
    const panelDashAttr = panelDash ? ` stroke-dasharray="${panelDash}"` : '';

    const accentColor = template.accent || (isDark ? '#0038ff' : '#00b2ff');
    const accentInk = pickAccentInk(accentColor);
    const pill = pickPillStyle(accentColor, template.background);
    const avatarInk = isNeo ? '#ffe600' : pickAvatarInk(accentColor);

    // ── Patterns per template ──────────────────────────────────────────────
    const patterns: Record<string, string> = {
      cyberpunk: `<pattern id="bgPattern" width="32" height="32" patternUnits="userSpaceOnUse">
        <path d="M32 0H0v32" fill="none" stroke="rgba(0,255,102,0.18)" stroke-width="1"/>
        <circle cx="32" cy="32" r="1.5" fill="rgba(0,255,102,0.18)"/>
      </pattern>`,
      neobrutalism: `<pattern id="bgPattern" width="24" height="24" patternUnits="userSpaceOnUse">
        <circle cx="12" cy="12" r="2.4" fill="rgba(0,0,0,0.15)"/>
      </pattern>`,
      rock: `<pattern id="bgPattern" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M0 20 L20 0 M-10 10 L10 -10 M10 30 L30 10" stroke="rgba(255,0,60,0.22)" stroke-width="1.5"/>
      </pattern>`,
      terminal: `<pattern id="bgPattern" width="10" height="6" patternUnits="userSpaceOnUse">
        <line x1="0" y1="1" x2="10" y2="1" stroke="rgba(0,240,255,0.18)" stroke-width="1"/>
      </pattern>`,
      bubblegum: `<pattern id="bgPattern" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M10 4 L11 8 L15 9 L11 10 L10 14 L9 10 L5 9 L9 8 Z" fill="rgba(255,255,255,0.24)"/>
        <circle cx="28" cy="24" r="1.8" fill="rgba(255,255,255,0.24)"/>
        <circle cx="14" cy="32" r="1.2" fill="rgba(255,255,255,0.24)"/>
      </pattern>`,
      swiss: `<pattern id="bgPattern" width="28" height="28" patternUnits="userSpaceOnUse">
        <path d="M28 0H0v28" fill="none" stroke="rgba(0,0,0,0.08)" stroke-width="1"/>
      </pattern>`,
      acid: `<pattern id="bgPattern" width="36" height="36" patternUnits="userSpaceOnUse">
        <path d="M0 18 Q9 0 18 18 T36 18" fill="none" stroke="rgba(204,255,0,0.22)" stroke-width="1.5"/>
      </pattern>`,
      monochrome: `<pattern id="bgPattern" width="30" height="30" patternUnits="userSpaceOnUse">
        <path d="M12 15h6 M15 12v6" stroke="rgba(0,0,0,0.16)" stroke-width="1.2"/>
      </pattern>`,
      indie: `<pattern id="bgPattern" width="16" height="16" patternUnits="userSpaceOnUse">
        <path d="M0 0 L16 16" stroke="rgba(253,240,213,0.18)" stroke-width="1.2"/>
      </pattern>`,
      blueprint: `<pattern id="bgPattern" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M40 0H0v40" fill="none" stroke="rgba(72,202,228,0.22)" stroke-width="1.2"/>
        <path d="M20 0v40 M0 20h40" fill="none" stroke="rgba(72,202,228,0.22)" stroke-dasharray="2,2" stroke-width="0.8"/>
      </pattern>`,
      default: `<pattern id="bgPattern" width="30" height="30" patternUnits="userSpaceOnUse">
        <circle cx="7.5" cy="7.5" r="1.5" fill="rgba(255,255,255,0.16)"/>
      </pattern>`,
    };

    const patternDef = isLegacy
      ? LEGACY_PATTERNS[template.key] || LEGACY_PATTERNS.default
      : template.pattern || patterns[template.key] || patterns.default;
    const scaledPatternDef = isFullBleed
      ? patternDef.replace(
          '<pattern ',
          `<pattern patternTransform="scale(${FULL_BLEED_PATTERN_SCALE})" `
        )
      : patternDef;

    // Semua template memakai warna solid — tanpa gradient agar teks selalu
    // terbaca dan hasil render identik dengan pratinjau.
    const bgFill = template.background;

    const W = aspect.width;
    const H = aspect.height;
    const PAD = 56;
    const cardW = W - PAD * 2;
    const cardH = H - PAD * 2;
    const isSquare = aspect.key === 'square';

    const contentX = PAD + 58;
    const contentWidth = cardW - 116;
    const footerTop = PAD + cardH - 72;
    const restContentY = PAD + 195;

    const measureFont = getMeasureFont(typo.family, typo.weight);
    const bodyText = typo.uppercase
      ? String(fess.content || '').toUpperCase()
      : String(fess.content || '');

    // ── Kotak kutipan (halaman pertama) — mengikuti kartu frontend: kotak
    //    kutipan diletakkan DI BAWAH isi fess, bukan menumpuk di atasnya. ──
    const quote = fess.quotedFess || null;
    const quoteBlock = quote
      ? buildQuoteBlock(quote, contentWidth, {
          isDark,
          textColor,
          subtextColor,
          cardBorder,
          accentColor: accentInk,
          pillFill: pill.fill,
          pillOpacity: pill.opacity,
          pillText: pill.text,
        })
      : null;
    const quoteHeight = quoteBlock ? quoteBlock.height : 0;
    // Batas atas area kutipan halaman 1 — teks fess wajib berhenti di atas ini
    // supaya isi fess tidak pernah tumpang tindih dengan kotak kutipan.
    const quoteTopLimit = footerTop - 32 - quoteHeight;

    // ── Pilih ukuran font terbesar yang muat ≤ MAX_PAGES halaman ───────────
    const baseTiers = isSquare
      ? [45, 39, 33, 28]
      : aspect.key === 'story'
      ? [52, 45, 38, 33]
      : [50, 42, 35, 31];
    const tiers = baseTiers.map((size) => Math.round(size * typo.scale));
    let fontSize = tiers[0];
    let letterSpacingPx = typo.letterSpacing * fontSize;
    let lineHeightPx = Math.round(fontSize * typo.lineHeight);
    let pages: TextPage[] = [];
    let truncated = false;

    for (const tier of tiers) {
      fontSize = tier;
      letterSpacingPx = typo.letterSpacing * fontSize;
      lineHeightPx = Math.round(fontSize * typo.lineHeight);
      const lines = layoutText(bodyText, contentWidth, fontSize, measureFont, letterSpacingPx);
      const restCap = Math.max(3, Math.floor((footerTop - 40 - restContentY) / lineHeightPx));
      // Halaman 1 dengan kutipan: kapasitas baris dikurangi agar baris terakhir
      // (beserta descender) tetap berada di atas area kutipan.
      const firstCap = quoteBlock
        ? Math.max(
            1,
            Math.floor((quoteTopLimit - 26 - restContentY - fontSize) / lineHeightPx) + 1
          )
        : restCap;
      const result = paginate(lines, firstCap, restCap, MAX_PAGES);
      pages = result.pages;
      truncated = result.truncated;
      if (!truncated) break;
    }

    if (!pages.length) pages = [[]];
    // Tandai fess yang terpotong (lebih dari MAX_PAGES) dengan ellipsis.
    if (truncated && pages.length) {
      const lastPage = pages[pages.length - 1];
      const lastLine = lastPage[lastPage.length - 1];
      if (lastLine) {
        lastLine.push({
          kind: 'text',
          text: '\u2026',
          width: measureTextWidth('\u2026', measureFont, fontSize, letterSpacingPx),
        });
      }
    }

    const avatarCy = PAD + 74;
    const headerNameY = PAD + 63;
    const headerHandleY = PAD + 93;
    const tagPillY = PAD + 50;

    const totalPages = pages.length;

    return pages.map((page, idx) => {
      const contentY = restContentY;
      const textSvg = renderTextLines(
        page,
        contentX,
        contentY,
        fontSize,
        lineHeightPx,
        textColor,
        {
          family: typo.family,
          weight: typo.weight,
          letterSpacingPx,
          align: typo.align,
        },
        contentWidth
      );
      // Kutipan diletakkan tepat di bawah baris terakhir halaman pertama, dan
      // di-clamp supaya kotaknya tidak pernah melewati batas bawah kartu.
      const pageQuoteSvg =
        idx === 0 && quoteBlock
          ? quoteBlock.render(
              contentX,
              Math.min(
                contentY + Math.max(0, page.length - 1) * lineHeightPx + fontSize + 26,
                quoteTopLimit
              )
            ) + '\n\n  '
          : '';
      const decoQuote =
        idx === 0 && !quoteBlock && typo.align === 'left'
          ? `<!-- Opening quote -->
  <text x="${PAD + 52}" y="${PAD + 172}" font-family="Poppins, Noto Sans, serif" font-size="72"
        font-weight="bold" fill="${accentInk}" opacity="0.28">&#8220;</text>
`
          : '';
      const footerRight = totalPages > 1 ? `${idx + 1}/${totalPages}` : 'fessncurious.vercel.app';

      return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    ${scaledPatternDef}
    <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
      ${shadowDef}
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="${bgFill}"/>

  <!-- Geometric texture overlay -->
  <rect width="${W}" height="${H}" fill="url(#bgPattern)"/>

  ${isFullBleed ? '' : `<!-- Card panel -->
  <rect x="${PAD}" y="${PAD}" width="${cardW}" height="${cardH}" rx="${cardRadius}"
        fill="${cardBg}" stroke="${cardBorder}" stroke-width="${cardBorderWidth}"${panelDashAttr}${cardFilter}/>`}

  <!-- Avatar -->
  <circle cx="${PAD + 74}" cy="${avatarCy}" r="38" fill="${accentColor}" opacity="0.25"/>
  <circle cx="${PAD + 74}" cy="${avatarCy}" r="32" fill="${accentColor}"/>
  <text x="${PAD + 74}" y="${avatarCy + 9}" font-family="Poppins, Arial, sans-serif" font-size="22"
        font-weight="900" fill="${avatarInk}" text-anchor="middle">${escapeXml(baseInitial)}</text>

  <!-- Base name & handle -->
  <text x="${PAD + 126}" y="${headerNameY}" font-family="Poppins, Arial, sans-serif" font-size="26"
        font-weight="900" fill="${textColor}">${escapeXml(baseName)}</text>
  <text x="${PAD + 126}" y="${headerHandleY}" font-family="Poppins, Arial, sans-serif" font-size="18"
        font-weight="600" fill="${subtextColor}">${escapeXml(fess.baseHandle)} · Fess n Curious</text>

  <!-- Tag pill -->
  <rect x="${PAD + cardW - 130}" y="${tagPillY}" width="106" height="34" rx="${isNeo ? 6 : 17}"
        fill="${isNeo ? accentInk : pill.fill}" opacity="${isNeo ? 1 : pill.opacity}"/>
  <text x="${PAD + cardW - 77}" y="${tagPillY + 23}" font-family="Poppins, Arial, sans-serif" font-size="14"
        font-weight="800" fill="${isNeo ? '#ffe600' : pill.text}" text-anchor="middle">${escapeXml(fess.tag || 'Confession')}</text>

  ${decoQuote}${pageQuoteSvg}<!-- Confession text -->
  ${textSvg}

  <!-- Footer divider -->
  <line x1="${PAD + 58}" y1="${footerTop}" x2="${PAD + cardW - 58}" y2="${footerTop}"
        stroke="${cardBorder}" stroke-width="1.5"/>

  <!-- Footer branding -->
  <text x="${PAD + 58}" y="${PAD + cardH - 36}" font-family="Poppins, Arial, sans-serif" font-size="17"
        font-weight="800" fill="${textColor}">Instagram Feed · ${escapeXml(baseIg)}</text>
  <text x="${PAD + cardW - 58}" y="${PAD + cardH - 36}" font-family="Poppins, Arial, sans-serif" font-size="15"
        font-weight="600" fill="${subtextColor}" text-anchor="end">${escapeXml(footerRight)}</text>
</svg>`;
    });
  }

  /** Render SVG card → Buffer PNG memakai font bundled (identik lokal & Vercel). */
  static renderSvgToPng(svg: string): Buffer {
    const fontFiles = getFontFiles();
    const resvg = new Resvg(svg, {
      font: fontFiles.length
        ? { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Poppins' }
        : { defaultFontFamily: 'Poppins' },
    });
    return Buffer.from(resvg.render().asPng());
  }

  /** Render SVG card → Buffer JPEG — format wajib Instagram untuk gambar. */
  static async renderSvgToJpeg(svg: string): Promise<Buffer> {
    const png = CanvasService.renderSvgToPng(svg);
    return sharp(png)
      .flatten({ background: '#ffffff' }) // kartu transparan → latar putih
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
  }

  /**
   * Render pratinjau kartu (PNG data URI) untuk modal konfirmasi posting.
   * Memakai builder & renderer yang sama dengan auto-post Instagram, jadi
   * bentuk teks, warna, dan paginasi identik dengan hasil yang diposting.
   */
  static renderPreviewImages(fess: FessLike, templateKey = 'default'): string[] {
    return CanvasService.buildSvgPages(fess, templateKey).map(
      (svg) => `data:image/png;base64,${CanvasService.renderSvgToPng(svg).toString('base64')}`
    );
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Urutan emoji (pictograph, modifier, ZWJ, variation selector, keycap, regional indicator). */
const EMOJI_SEQ_RE =
  /([\p{Extended_Pictographic}\p{Emoji_Modifier}\u200D\uFE0F\u20E3\u{1F1E6}-\u{1F1FF}]+)/gu;

let graphemeSegmenter: Intl.Segmenter | null | undefined;

/** Pecah rentetan emoji menjadi grapheme (🇮🇩🙏 → 🇮🇩 + 🙏; ZWJ & skin tone tetap utuh). */
function splitGraphemes(text: string): string[] {
  if (graphemeSegmenter === undefined) {
    try {
      graphemeSegmenter = new Intl.Segmenter('id', { granularity: 'grapheme' });
    } catch {
      graphemeSegmenter = null;
    }
  }
  if (!graphemeSegmenter) return [...text];
  return Array.from(graphemeSegmenter.segment(text), (entry) => entry.segment);
}

/**
 * Ambang luminance sederhana (WCAG kasar) untuk memilih warna ink.
 * true = warna termasuk terang (mis. putih, krem, mint).
 */
function colorLuminance(color: string): number | null {
  const match = /^#([0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!match) return null;
  const r = parseInt(match[1].slice(0, 2), 16);
  const g = parseInt(match[1].slice(2, 4), 16);
  const b = parseInt(match[1].slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Warna aksen terang (mis. putih template default) tidak terbaca sebagai teks
 * di atas kartu — ganti ke biru brand untuk elemen ink.
 */
function pickAccentInk(color: string): string {
  const luminance = colorLuminance(color);
  if (luminance === null) return color;
  return luminance > 0.72 ? '#0038ff' : color;
}

/**
 * Gaya pill (tag "Cerita/Tanya" & badge "Kutip") supaya teksnya selalu
 * terbaca: aksen terang memakai pill solid dengan teks senada background,
 * aksen medium/gelap tetap gaya transparan seperti semula.
 */
function pickPillStyle(
  accent: string,
  background: string
): { fill: string; opacity: number; text: string } {
  const accentLum = colorLuminance(accent);
  const bgLum = colorLuminance(background);

  // Aksen terang → pill solid dengan teks gelap/warna background gelap.
  if (accentLum !== null && accentLum > 0.72) {
    const text = bgLum !== null && bgLum < 0.55 ? background : '#0b0d14';
    return { fill: accent, opacity: 0.95, text };
  }

  // Aksen gelap → pill solid + teks putih/hitam sesuai luminance aksen.
  // Sebelumnya teks aksen di atas fill transparan senada bisa tenggelam
  // (mis. merah di atas merah tua pada template Poster).
  if (accentLum !== null && accentLum < 0.5) {
    return {
      fill: accent,
      opacity: 0.96,
      text: accentLum >= 0.48 ? '#0b0d14' : '#ffffff',
    };
  }

  // Aksen medium di atas kartu terang → pill solid agar kontras aman.
  if (bgLum !== null && bgLum > 0.55) {
    return {
      fill: accent,
      opacity: 0.96,
      text: accentLum !== null && accentLum >= 0.48 ? '#0b0d14' : '#ffffff',
    };
  }

  // Aksen medium di atas kartu gelap → gaya transparan tetap terbaca.
  return { fill: accent, opacity: 0.22, text: accent };
}

/**
 * Warna inisial avatar di atas lingkaran accent — dijamin kontras.
 * Sebelumnya accent gelap/medium memakai warnanya sendiri sehingga inisial
 * tidak terlihat (mis. hitam di atas hitam pada Neo-Brutalism).
 */
function pickAvatarInk(color: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!match) return '#ffffff';
  const r = parseInt(match[1].slice(0, 2), 16);
  const g = parseInt(match[1].slice(2, 4), 16);
  const b = parseInt(match[1].slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luminance > 0.72) return '#0038ff'; // accent terang → biru brand (perilaku lama)
  if (luminance < 0.45) return '#ffffff'; // accent gelap → putih
  return '#0b1220'; // accent menengah → tinta gelap
}

/** Potong pesan error agar kolom status tetap ringkas dan aman. */
function clipIgError(value: string, max = 1200): string {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Media user (gambar/video) yang layak ikut diposting ke Instagram. */
interface CollectedMediaItem {
  type: 'image' | 'video';
  url: string;
  width?: number;
  height?: number;
  duration?: number | null;
}

function collectMediaItems(media: unknown): CollectedMediaItem[] {
  if (!Array.isArray(media)) return [];
  const items: CollectedMediaItem[] = [];
  for (const entry of media) {
    const url = String((entry as any)?.url || '');
    if (!/^https?:\/\//i.test(url)) continue;
    const isVideo = (entry as any)?.type === 'video';
    // Meta hanya menerima video MP4/MOV (M4V) — lewati format lain.
    if (isVideo && !/\.(mp4|mov|m4v)(\?.*)?$/i.test(url)) {
      console.warn('[Canvas] Media video dilewati (bukan MP4/MOV/M4V):', url);
      continue;
    }
    const width = Number((entry as any)?.width);
    const height = Number((entry as any)?.height);
    const duration = Number((entry as any)?.duration);
    items.push({
      type: isVideo ? 'video' : 'image',
      url,
      ...(Number.isFinite(width) && width > 0 ? { width } : {}),
      ...(Number.isFinite(height) && height > 0 ? { height } : {}),
      ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
    });
  }
  return items;
}

// ── Pengukuran teks (opentype.js) ──────────────────────────────────────────

const opentypeCache = new Map<string, opentype.Font | null>();

/** Muat file font sesuai keluarga + weight untuk pengukuran lebar teks. */
function getMeasureFont(
  family: FontFamilyKey = 'sans',
  weight = 400
): opentype.Font | null {
  const cacheKey = `${family}:${weight}`;
  if (opentypeCache.has(cacheKey)) return opentypeCache.get(cacheKey)!;
  const file = getFontFileFor(family, weight);
  let font: opentype.Font | null = null;
  if (file) {
    try {
      font = opentype.parse(fs.readFileSync(file) as unknown as ArrayBuffer);
    } catch (err: any) {
      console.warn(`[Canvas] Gagal memuat font pengukuran ${family}:`, err?.message || err);
    }
  }
  opentypeCache.set(cacheKey, font);
  return font;
}

/** Perkiraan lebar teks saat font pengukuran tidak tersedia. */
function approxWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55;
}

/** Lebar teks termasuk letter-spacing (dalam px pada ukuran font saat ini). */
function measureTextWidth(
  text: string,
  font: opentype.Font | null,
  fontSize: number,
  letterSpacingPx = 0
): number {
  const base = font ? font.getAdvanceWidth(text, fontSize) : approxWidth(text, fontSize);
  return base + Math.max(0, text.length) * letterSpacingPx;
}

/** Pecah satu paragraf menjadi segmen teks/emoji dengan lebar terukur. */
function segmentsFor(
  text: string,
  fontSize: number,
  font: opentype.Font | null,
  letterSpacingPx = 0
): TextSegment[] {
  const segments: TextSegment[] = [];
  const parts = text.split(EMOJI_SEQ_RE);
  parts.forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1) {
      // Emoji → inline SVG Twemoji (viewBox 36x36) atau fallback font emoji.
      // Dipecah per grapheme agar 🇮🇩🙏 tidak dianggap satu sekuens.
      for (const grapheme of splitGraphemes(part)) {
        segments.push({
          kind: 'emoji',
          text: grapheme,
          width: fontSize * 1.12,
          svg: getEmojiSvgMarkup(grapheme) || undefined,
        });
      }
    } else {
      // Teks: pecah per kata, spasi menempel di akhir kata (atau spasi murni).
      const tokens = part.match(/\s+|[^\s]+\s*/g) || [];
      for (const token of tokens) {
        segments.push({
          kind: 'text',
          text: token,
          width: measureTextWidth(token, font, fontSize, letterSpacingPx),
        });
      }
    }
  });
  return segments;
}

/** Susun teks menjadi baris-baris dengan pengukuran lebar nyata + word wrap. */
function layoutText(
  rawText: string,
  maxWidth: number,
  fontSize: number,
  font: opentype.Font | null,
  letterSpacingPx = 0
): TextLine[] {
  const lines: TextLine[] = [];

  for (const paragraph of String(rawText || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (paragraph.trim() === '') {
      lines.push([]);
      continue;
    }

    let line: TextLine = [];
    let lineWidth = 0;

    const flush = () => {
      if (line.length) lines.push(line);
      line = [];
      lineWidth = 0;
    };

    for (const rawSegment of segmentsFor(paragraph, fontSize, font, letterSpacingPx)) {
      let segment = rawSegment;

      // Buang spasi di awal baris baru.
      if (!line.length && segment.kind === 'text') {
        const trimmed = segment.text.replace(/^\s+/, '');
        if (!trimmed) continue;
        segment = {
          ...segment,
          text: trimmed,
          width: measureTextWidth(trimmed, font, fontSize, letterSpacingPx),
        };
      }

      if (line.length && lineWidth + segment.width > maxWidth) {
        flush();
        if (segment.kind === 'text') {
          const trimmed = segment.text.replace(/^\s+/, '');
          if (!trimmed) continue;
          segment = {
            ...segment,
            text: trimmed,
            width: measureTextWidth(trimmed, font, fontSize, letterSpacingPx),
          };
        }
      }

      line.push(segment);
      lineWidth += segment.width;
    }

    flush();
  }

  return lines;
}

/** Bagi baris-baris menjadi halaman (carousel) dengan kapasitas berbeda di halaman pertama. */
function paginate(
  lines: TextLine[],
  firstCap: number,
  restCap: number,
  maxPages: number
): { pages: TextPage[]; truncated: boolean } {
  const pages: TextPage[] = [];
  let idx = 0;
  while (idx < lines.length && pages.length < maxPages) {
    const cap = pages.length === 0 ? firstCap : restCap;
    pages.push(lines.slice(idx, idx + cap));
    idx += cap;
  }
  return { pages, truncated: idx < lines.length };
}

/** Gaya render satu blok teks (isi fess atau kutipan). */
interface TextRenderStyle {
  family: FontFamilyKey;
  weight: number;
  letterSpacingPx: number;
  align: 'left' | 'center';
}

/** Render baris teks + emoji inline menjadi elemen SVG absolut. */
function renderTextLines(
  lines: TextLine[],
  x: number,
  y: number,
  fontSize: number,
  lineHeightPx: number,
  color: string,
  style: TextRenderStyle,
  maxWidth: number
): string {
  const out: string[] = [];
  const emojiSize = fontSize * 1.12;
  const fontStack = getFontCssStack(style.family);
  const letterSpacingAttr =
    style.letterSpacingPx > 0
      ? ` letter-spacing="${style.letterSpacingPx.toFixed(2)}"`
      : '';

  lines.forEach((line, li) => {
    const baseline = Math.round(y + li * lineHeightPx);
    const lineWidth = line.reduce((sum, segment) => sum + segment.width, 0);
    let cursor =
      style.align === 'center'
        ? x + Math.max(0, (maxWidth - lineWidth) / 2)
        : x;
    for (const segment of line) {
      if (segment.kind === 'text') {
        out.push(
          `<text x="${cursor.toFixed(1)}" y="${baseline}" font-family="${fontStack}" font-size="${fontSize}" font-weight="${style.weight}"${letterSpacingAttr} fill="${color}" xml:space="preserve">${escapeXml(segment.text)}</text>`
        );
      } else if (segment.svg) {
        const scale = emojiSize / 36;
        out.push(
          `<g transform="translate(${cursor.toFixed(1)}, ${(baseline - fontSize * 0.92).toFixed(1)}) scale(${scale.toFixed(4)})">${segment.svg}</g>`
        );
      } else {
        out.push(
          `<text x="${cursor.toFixed(1)}" y="${baseline}" font-family="Noto Emoji, ${fontStack}" font-size="${fontSize}" font-weight="${style.weight}" fill="${color}">${escapeXml(segment.text)}</text>`
        );
      }
      cursor += segment.width;
    }
  });

  return out.join('\n    ');
}

/** Ukur & bangun kotak kutipan (mirip preview quote di frontend) — di bawah isi fess. */
function buildQuoteBlock(
  quote: any,
  width: number,
  theme: {
    isDark: boolean;
    textColor: string;
    subtextColor: string;
    cardBorder: string;
    accentColor: string;
    pillFill: string;
    pillOpacity: number;
    pillText: string;
  }
): { height: number; render: (x: number, y: number) => string } {
  const PADQ = 18;
  const HEADER_H = 48;
  const QFONT = 29;
  const QLH = 40;

  const rawHandle = String(quote.handle || quote.senderHandle || '@anonim');
  const handle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;
  const content = String(quote.content || '');
  const time = String(quote.time || '');
  const avatarBg = quote.avatar_bg || quote.avatarBg || theme.accentColor;
  const avatarText = (
    quote.avatar_text ||
    quote.avatarText ||
    handle.replace(/^@/, '').slice(0, 2) ||
    'FS'
  ).toUpperCase();

  const measureFont = getMeasureFont('sans', 500);
  let qlines = layoutText(content, width - PADQ * 2, QFONT, measureFont);
  if (qlines.length > MAX_QUOTE_LINES) {
    qlines = qlines.slice(0, MAX_QUOTE_LINES);
    const lastLine = qlines[qlines.length - 1];
    if (lastLine) {
      lastLine.push({
        kind: 'text',
        text: '\u2026',
        width: measureTextWidth('\u2026', measureFont, QFONT),
      });
    }
  }

  const height = PADQ + HEADER_H + Math.max(1, qlines.length) * QLH + 14;
  const boxBg = theme.isDark ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.07)';
  const handleWidth = measureTextWidth(handle, measureFont, 22);

  const render = (x: number, y: number): string => {
    const avatarCx = x + PADQ + 21;
    const avatarCy = y + PADQ + HEADER_H / 2;
    const handleX = x + PADQ + 56;
    const handleY = y + PADQ + 33;

    const timeSvg = time
      ? `<text x="${(handleX + handleWidth + 12).toFixed(1)}" y="${handleY - 1}" font-family="Poppins, Arial, sans-serif" font-size="16" font-weight="500" fill="${theme.subtextColor}">${escapeXml(time)}</text>`
      : '';

    const pillW = 78;
    const pillH = 30;
    const pillX = x + width - PADQ - pillW;
    const pillY = y + PADQ + 8;

    const linesSvg = renderTextLines(
      qlines,
      x + PADQ,
      y + PADQ + HEADER_H + 18,
      QFONT,
      QLH,
      theme.subtextColor,
      { family: 'sans', weight: 500, letterSpacingPx: 0, align: 'left' },
      width - PADQ * 2
    );

    return `<!-- Quoted fess box -->
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18"
        fill="${boxBg}" stroke="${theme.cardBorder}" stroke-width="1.5"/>
  <circle cx="${avatarCx}" cy="${avatarCy}" r="21" fill="${avatarBg}"/>
  <text x="${avatarCx}" y="${avatarCy + 6}" font-family="Poppins, Arial, sans-serif" font-size="17"
        font-weight="800" fill="#ffffff" text-anchor="middle">${escapeXml(avatarText)}</text>
  <text x="${handleX}" y="${handleY}" font-family="Poppins, Arial, sans-serif" font-size="22"
        font-weight="700" fill="${theme.textColor}">${escapeXml(handle)}</text>
  ${timeSvg}
  <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="15"
        fill="${theme.pillFill}" fill-opacity="${theme.pillOpacity}" stroke="${theme.pillFill}" stroke-opacity="0.3" stroke-width="1"/>
  <text x="${(pillX + pillW / 2).toFixed(1)}" y="${pillY + 20}" font-family="Poppins, Arial, sans-serif" font-size="15"
        font-weight="800" fill="${theme.pillText}" text-anchor="middle">Kutip</text>
  ${linesSvg}`;
  };

  return { height, render };
}
