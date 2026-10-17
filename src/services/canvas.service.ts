import fs from 'fs';
import opentype from 'opentype.js';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { ASPECTS, getTemplateByKey } from '../constants/templates.js';
import { StorageService } from './storage.service.js';
import { prisma } from '../config/prisma.js';
import { InstagramService } from './instagram.service.js';
import { getFontFiles, getPoppinsFontFile } from '../config/fonts.js';
import { getEmojiSvgMarkup } from '../config/emoji.js';

export interface CanvasExportResult {
  image_url: string;
  image_urls: string[];
  card_count: number;
  media_count: number;
  posted_to: ('instagram' | 'twitter' | 'telegram')[];
  ig_result?: any;
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

const MAX_PAGES = 10; // batas carousel Instagram
const MAX_QUOTE_LINES = 4;

export class CanvasService {
  /**
   * Render confession card → PNG (satu atau beberapa halaman untuk carousel)
   * → upload ke Supabase → auto-post ke Instagram Feed.
   *
   * aspectKey opsional: 'square' (1:1) atau 'portrait' (4:5). Kosong / kunci
   * tak dikenal → ikut aspek template (agar kartu IG persis seperti pratinjau
   * composer, termasuk template persegi).
   */
  static async exportFessCanvas(
    fessId: string,
    templateKey = 'default',
    aspectKey = ''
  ): Promise<CanvasExportResult> {
    const fess = await prisma.fess.findUnique({
      where: { id: fessId },
      include: { base: true },
    });

    if (!fess) {
      throw new Error('Fess tidak ditemukan');
    }

    // Resolve template/aspect sekali lagi untuk penamaan file upload.
    const template = getTemplateByKey(templateKey || fess.template || 'default');
    const aspect = ASPECTS[aspectKey] || (template.aspect === 'square' ? ASPECTS.square : ASPECTS.portrait);

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
      .map((url) => ({ type: 'image' as const, url }));
    const postItems = [...cardItems, ...mediaItems].slice(0, 10);

    // Caption = isi fess penuh (pemotongan batas 2200 char ditangani InstagramService).
    const caption = String(fess.content || '');

    // Meta Graph API butuh URL publik HTTP(S) — lewati data-URI.
    const hasPublicUrl = imageUrls.some((u) => !u.startsWith('data:'));
    if (hasPublicUrl) {
      try {
        ig_result = await InstagramService.autoPostFess(fess.baseHandle, fess.id, postItems, caption);
        if (ig_result?.meta_published === true) {
          posted_to.push('instagram');
        }
      } catch (igErr: any) {
        console.warn('[Canvas] Instagram auto-post failed:', igErr.message);
      }
    } else {
      console.warn(
        '[Canvas] Storage returned a data-URI — Instagram auto-post skipped.' +
        ' Configure SUPABASE_URL/SUPABASE_KEY for production IG posting.'
      );
    }

    // Mark fess as posted (hanya jika benar-benar terbit ke Instagram)
    if (posted_to.includes('instagram')) {
      await prisma.fess.update({
        where: { id: fessId },
        data: { postedToIg: true },
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
    // Resolve aspect — kosong / kunci legacy jatuh ke aspek template.
    const aspect = ASPECTS[aspectKey] || (template.aspect === 'square' ? ASPECTS.square : ASPECTS.portrait);

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
    const textColor = isDark ? '#1a1a2e' : '#ffffff';
    const subtextColor = isDark ? 'rgba(26,26,46,0.7)' : 'rgba(255,255,255,0.75)';
    const cardBg = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.08)';
    const cardBorder = isDark ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.18)';
    const accentColor = template.accent || (isDark ? '#0038ff' : '#00b2ff');
    const accentInk = pickAccentInk(accentColor);

    // ── Gradient definitions per template ──────────────────────────────────
    const gradients: Record<string, string> = {
      default: `<linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0038ff"/>
        <stop offset="50%" stop-color="#4b1fff"/>
        <stop offset="100%" stop-color="#7000ff"/>
      </linearGradient>`,
      midnight: `<radialGradient id="bgGrad" cx="30%" cy="20%" r="80%">
        <stop offset="0%" stop-color="#1e295d"/>
        <stop offset="60%" stop-color="#0a0e27"/>
        <stop offset="100%" stop-color="#030511"/>
      </radialGradient>`,
      sunset: `<linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ff6b35"/>
        <stop offset="45%" stop-color="#f72585"/>
        <stop offset="100%" stop-color="#7209b7"/>
      </linearGradient>`,
      forest: `<linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f766e"/>
        <stop offset="60%" stop-color="#064e3b"/>
        <stop offset="100%" stop-color="#022c22"/>
      </linearGradient>`,
      noir: `<linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#0f111a"/>
        <stop offset="50%" stop-color="#161926"/>
        <stop offset="100%" stop-color="#090a10"/>
      </linearGradient>`,
      paper: `<linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#fef8ee"/>
        <stop offset="60%" stop-color="#f5ede0"/>
        <stop offset="100%" stop-color="#e9dfcf"/>
      </linearGradient>`,
      ocean: `<linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#06b6d4"/>
        <stop offset="45%" stop-color="#0284c7"/>
        <stop offset="100%" stop-color="#1e3a8a"/>
      </linearGradient>`,
      violet: `<linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#7c3aed"/>
        <stop offset="50%" stop-color="#c026d3"/>
        <stop offset="100%" stop-color="#f43f5e"/>
      </linearGradient>`,
    };
    const bgDef = gradients[template.key] || gradients.default;

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

    const measureFont = getMeasureFont(600);

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
        })
      : null;
    const quoteHeight = quoteBlock ? quoteBlock.height : 0;
    // Batas atas area kutipan halaman 1 — teks fess wajib berhenti di atas ini
    // supaya isi fess tidak pernah tumpang tindih dengan kotak kutipan.
    const quoteTopLimit = footerTop - 32 - quoteHeight;

    // ── Pilih ukuran font terbesar yang muat ≤ MAX_PAGES halaman ───────────
    const tiers = isSquare ? [38, 33, 28, 24] : [42, 36, 30, 26];
    let fontSize = tiers[0];
    let lineHeightPx = Math.round(fontSize * 1.42);
    let pages: TextPage[] = [];
    let truncated = false;

    for (const tier of tiers) {
      fontSize = tier;
      lineHeightPx = Math.round(fontSize * 1.42);
      const lines = layoutText(fess.content || '', contentWidth, fontSize, measureFont);
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
    if (truncated && pages.length) {
      const lastPage = pages[pages.length - 1];
      const lastLine = lastPage[lastPage.length - 1];
      if (lastLine) {
        lastLine.push({
          kind: 'text',
          text: '\u2026',
          width: measureFont ? measureFont.getAdvanceWidth('\u2026', fontSize) : fontSize * 0.55,
        });
      }
    }

    const totalPages = pages.length;

    return pages.map((page, idx) => {
      const contentY = restContentY;
      const textSvg = renderTextLines(page, contentX, contentY, fontSize, lineHeightPx, textColor, 600);
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
        idx === 0 && !quoteBlock
          ? `<!-- Opening quote -->
  <text x="${PAD + 52}" y="${PAD + 172}" font-family="Poppins, Noto Sans, serif" font-size="72"
        font-weight="bold" fill="${accentInk}" opacity="0.28">&#8220;</text>
`
          : '';
      const footerRight = totalPages > 1 ? `${idx + 1}/${totalPages}` : 'fessncurious.vercel.app';

      return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    ${bgDef}
    <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="18" stdDeviation="28" flood-color="#000000" flood-opacity="0.25"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bgGrad)"/>

  <!-- Dot grid overlay -->
  <pattern id="dots" width="30" height="30" patternUnits="userSpaceOnUse">
    <circle cx="7.5" cy="7.5" r="1.5" fill="rgba(255,255,255,0.10)"/>
  </pattern>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>

  <!-- Card panel -->
  <rect x="${PAD}" y="${PAD}" width="${cardW}" height="${cardH}" rx="36"
        fill="${cardBg}" stroke="${cardBorder}" stroke-width="2"
        filter="url(#cardShadow)"/>

  <!-- Avatar -->
  <circle cx="${PAD + 74}" cy="${PAD + 74}" r="38" fill="${accentColor}" opacity="0.25"/>
  <circle cx="${PAD + 74}" cy="${PAD + 74}" r="32" fill="${accentColor}"/>
  <text x="${PAD + 74}" y="${PAD + 83}" font-family="Poppins, Arial, sans-serif" font-size="22"
        font-weight="900" fill="${accentInk}" text-anchor="middle">${escapeXml(baseInitial)}</text>

  <!-- Base name & handle -->
  <text x="${PAD + 126}" y="${PAD + 63}" font-family="Poppins, Arial, sans-serif" font-size="26"
        font-weight="900" fill="${textColor}">${escapeXml(baseName)}</text>
  <text x="${PAD + 126}" y="${PAD + 93}" font-family="Poppins, Arial, sans-serif" font-size="18"
        font-weight="600" fill="${subtextColor}">${escapeXml(fess.baseHandle)} · Fess n Curious</text>

  <!-- Tag pill -->
  <rect x="${PAD + cardW - 130}" y="${PAD + 50}" width="106" height="34" rx="17"
        fill="${accentInk}" opacity="0.22"/>
  <text x="${PAD + cardW - 77}" y="${PAD + 73}" font-family="Poppins, Arial, sans-serif" font-size="14"
        font-weight="800" fill="${accentInk}" text-anchor="middle">${escapeXml(fess.tag || 'Confession')}</text>

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
 * Warna aksen terang (mis. putih template default) tidak terbaca sebagai teks
 * di atas kartu — ganti ke biru brand untuk elemen ink.
 */
function pickAccentInk(color: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!match) return color;
  const r = parseInt(match[1].slice(0, 2), 16);
  const g = parseInt(match[1].slice(2, 4), 16);
  const b = parseInt(match[1].slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.72 ? '#0038ff' : color;
}

/** Media user (gambar/video) yang layak ikut diposting ke Instagram. */
function collectMediaItems(media: unknown): { type: 'image' | 'video'; url: string }[] {
  if (!Array.isArray(media)) return [];
  const items: { type: 'image' | 'video'; url: string }[] = [];
  for (const entry of media) {
    const url = String((entry as any)?.url || '');
    if (!/^https?:\/\//i.test(url)) continue;
    const isVideo = (entry as any)?.type === 'video';
    // Meta hanya menerima video MP4/MOV (M4V) — lewati format lain.
    if (isVideo && !/\.(mp4|mov|m4v)(\?.*)?$/i.test(url)) {
      console.warn('[Canvas] Media video dilewati (bukan MP4/MOV/M4V):', url);
      continue;
    }
    items.push({ type: isVideo ? 'video' : 'image', url });
  }
  return items;
}

// ── Pengukuran teks (opentype.js) ──────────────────────────────────────────

const opentypeCache = new Map<number, opentype.Font | null>();

/** Muat font Poppins untuk pengukuran lebar teks (cache per weight). */
function getMeasureFont(weight: number): opentype.Font | null {
  if (opentypeCache.has(weight)) return opentypeCache.get(weight)!;
  const file = getPoppinsFontFile(weight);
  let font: opentype.Font | null = null;
  if (file) {
    try {
      font = opentype.parse(fs.readFileSync(file) as unknown as ArrayBuffer);
    } catch (err: any) {
      console.warn('[Canvas] Gagal memuat font pengukuran Poppins:', err?.message || err);
    }
  }
  opentypeCache.set(weight, font);
  return font;
}

/** Perkiraan lebar teks saat font pengukuran tidak tersedia. */
function approxWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55;
}

/** Pecah satu paragraf menjadi segmen teks/emoji dengan lebar terukur. */
function segmentsFor(text: string, fontSize: number, font: opentype.Font | null): TextSegment[] {
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
          width: font ? font.getAdvanceWidth(token, fontSize) : approxWidth(token, fontSize),
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
  font: opentype.Font | null
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

    for (const rawSegment of segmentsFor(paragraph, fontSize, font)) {
      let segment = rawSegment;

      // Buang spasi di awal baris baru.
      if (!line.length && segment.kind === 'text') {
        const trimmed = segment.text.replace(/^\s+/, '');
        if (!trimmed) continue;
        segment = {
          ...segment,
          text: trimmed,
          width: font ? font.getAdvanceWidth(trimmed, fontSize) : approxWidth(trimmed, fontSize),
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
            width: font ? font.getAdvanceWidth(trimmed, fontSize) : approxWidth(trimmed, fontSize),
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

/** Render baris teks + emoji inline menjadi elemen SVG absolut. */
function renderTextLines(
  lines: TextLine[],
  x: number,
  y: number,
  fontSize: number,
  lineHeightPx: number,
  color: string,
  weight: number
): string {
  const out: string[] = [];
  const emojiSize = fontSize * 1.12;

  lines.forEach((line, li) => {
    const baseline = Math.round(y + li * lineHeightPx);
    let cursor = x;
    for (const segment of line) {
      if (segment.kind === 'text') {
        out.push(
          `<text x="${cursor.toFixed(1)}" y="${baseline}" font-family="Poppins, Noto Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${color}" xml:space="preserve">${escapeXml(segment.text)}</text>`
        );
      } else if (segment.svg) {
        const scale = emojiSize / 36;
        out.push(
          `<g transform="translate(${cursor.toFixed(1)}, ${(baseline - fontSize * 0.92).toFixed(1)}) scale(${scale.toFixed(4)})">${segment.svg}</g>`
        );
      } else {
        out.push(
          `<text x="${cursor.toFixed(1)}" y="${baseline}" font-family="Noto Emoji, Poppins, Noto Sans, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${color}">${escapeXml(segment.text)}</text>`
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
  theme: { isDark: boolean; textColor: string; subtextColor: string; cardBorder: string; accentColor: string }
): { height: number; render: (x: number, y: number) => string } {
  const PADQ = 18;
  const HEADER_H = 48;
  const QFONT = 25;
  const QLH = 34;

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

  const measureFont = getMeasureFont(500);
  let qlines = layoutText(content, width - PADQ * 2, QFONT, measureFont);
  if (qlines.length > MAX_QUOTE_LINES) {
    qlines = qlines.slice(0, MAX_QUOTE_LINES);
    const lastLine = qlines[qlines.length - 1];
    if (lastLine) {
      lastLine.push({
        kind: 'text',
        text: '\u2026',
        width: measureFont ? measureFont.getAdvanceWidth('\u2026', QFONT) : approxWidth('\u2026', QFONT),
      });
    }
  }

  const height = PADQ + HEADER_H + Math.max(1, qlines.length) * QLH + 14;
  const boxBg = theme.isDark ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.07)';
  const handleWidth = measureFont ? measureFont.getAdvanceWidth(handle, 22) : approxWidth(handle, 22);

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
      500
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
        fill="${theme.accentColor}" fill-opacity="0.16" stroke="${theme.accentColor}" stroke-opacity="0.3" stroke-width="1"/>
  <text x="${(pillX + pillW / 2).toFixed(1)}" y="${pillY + 20}" font-family="Poppins, Arial, sans-serif" font-size="15"
        font-weight="800" fill="${theme.accentColor}" text-anchor="middle">Kutip</text>
  ${linesSvg}`;
  };

  return { height, render };
}
