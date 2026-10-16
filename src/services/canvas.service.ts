import sharp from 'sharp';
import { ASPECTS, getTemplateByKey } from '../constants/templates.js';
import { StorageService } from './storage.service.js';
import { prisma } from '../config/prisma.js';
import { InstagramService } from './instagram.service.js';

export interface CanvasExportResult {
  image_url: string;
  posted_to: ('instagram' | 'twitter' | 'telegram')[];
  ig_result?: any;
}

export class CanvasService {
  /**
   * Render confession card → PNG → upload to Supabase → auto-post to Instagram Feed.
   * aspectKey must be 'square' (1:1) or 'portrait' (4:5). Any unknown key falls back to 'portrait'.
   */
  static async exportFessCanvas(
    fessId: string,
    templateKey = 'default',
    aspectKey = 'portrait'
  ): Promise<CanvasExportResult> {
    const fess = await prisma.fess.findUnique({
      where: { id: fessId },
      include: { base: true },
    });

    if (!fess) {
      throw new Error('Fess tidak ditemukan');
    }

    const template = getTemplateByKey(templateKey || fess.template || 'default');
    // Resolve aspect — 'story' legacy key falls back to 'portrait'
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

    // ── Dynamic font sizing based on content length & aspect ───────────────
    const textLen = (fess.content || '').length;
    const isSquare = aspect.key === 'square';
    let fontSize = isSquare ? 36 : 40;
    let lineHeight = 1.45;
    if (textLen > 350) {
      fontSize = isSquare ? 23 : 26;
      lineHeight = 1.38;
    } else if (textLen > 200) {
      fontSize = isSquare ? 26 : 30;
      lineHeight = 1.4;
    } else if (textLen > 100) {
      fontSize = isSquare ? 30 : 34;
      lineHeight = 1.42;
    }

    const W = aspect.width;
    const H = aspect.height;
    const PAD = 56;
    const cardW = W - PAD * 2;
    const cardH = H - PAD * 2;

    // ── Build SVG with native tspan word-wrap (sharp-compatible, no foreignObject) ──
    const textSvg = buildTextLines(fess.content, cardW - 120, fontSize, lineHeight, PAD + 60, PAD + 195, textColor);

    const svgCard = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
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
  <text x="${PAD + 74}" y="${PAD + 83}" font-family="Noto Sans, Arial, sans-serif" font-size="22"
        font-weight="900" fill="#fff" text-anchor="middle">${escapeXml(baseInitial)}</text>

  <!-- Base name & handle -->
  <text x="${PAD + 126}" y="${PAD + 63}" font-family="Noto Sans, Arial, sans-serif" font-size="26"
        font-weight="900" fill="${textColor}">${escapeXml(baseName)}</text>
  <text x="${PAD + 126}" y="${PAD + 93}" font-family="Noto Sans, Arial, sans-serif" font-size="18"
        font-weight="600" fill="${subtextColor}">${escapeXml(fess.baseHandle)} · Fess n Curious</text>

  <!-- Tag pill -->
  <rect x="${PAD + cardW - 130}" y="${PAD + 50}" width="106" height="34" rx="17"
        fill="${accentColor}" opacity="0.22"/>
  <text x="${PAD + cardW - 77}" y="${PAD + 73}" font-family="Noto Sans, Arial, sans-serif" font-size="14"
        font-weight="800" fill="${accentColor}" text-anchor="middle">${escapeXml(fess.tag || 'Confession')}</text>

  <!-- Opening quote -->
  <text x="${PAD + 52}" y="${PAD + 172}" font-family="Noto Sans, serif" font-size="72"
        font-weight="bold" fill="${accentColor}" opacity="0.28">"</text>

  <!-- Confession text -->
  ${textSvg}

  <!-- Footer divider -->
  <line x1="${PAD + 58}" y1="${PAD + cardH - 72}" x2="${PAD + cardW - 58}" y2="${PAD + cardH - 72}"
        stroke="${cardBorder}" stroke-width="1.5"/>

  <!-- Footer branding -->
  <text x="${PAD + 58}" y="${PAD + cardH - 36}" font-family="Noto Sans, Arial, sans-serif" font-size="17"
        font-weight="800" fill="${textColor}">Instagram Feed · ${escapeXml(baseIg)}</text>
  <text x="${PAD + cardW - 58}" y="${PAD + cardH - 36}" font-family="Noto Sans, Arial, sans-serif" font-size="15"
        font-weight="600" fill="${subtextColor}" text-anchor="end">fessncurious.vercel.app</text>
</svg>`;

    // ── SVG → PNG via sharp (Meta Graph API only accepts JPEG/PNG URLs) ────
    const svgBuffer = Buffer.from(svgCard, 'utf-8');
    let uploadBuffer: Buffer = svgBuffer;
    let mimeType = 'image/svg+xml';
    let fileExt = 'svg';

    try {
      uploadBuffer = await sharp(svgBuffer).png({ quality: 95, compressionLevel: 6 }).toBuffer();
      mimeType = 'image/png';
      fileExt = 'png';
    } catch (sharpErr: any) {
      console.warn('[Canvas] sharp PNG conversion failed, falling back to SVG:', sharpErr.message);
    }

    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: `canvas_${fessId}_${template.key}_${aspect.key}.${fileExt}`,
      encoding: '7bit',
      mimetype: mimeType,
      size: uploadBuffer.length,
      buffer: uploadBuffer,
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };

    const upload = await StorageService.uploadMedia(mockFile, 'canvas-exports');

    // ── Auto-post to Instagram Feed ────────────────────────────────────────
    const posted_to: ('instagram' | 'twitter' | 'telegram')[] = [];
    let ig_result: any = null;

    // Meta Graph API requires a publicly accessible HTTP(S) URL — skip data-URIs
    if (!upload.url.startsWith('data:')) {
      try {
        ig_result = await InstagramService.autoPostFess(
          fess.baseHandle,
          fess.id,
          upload.url,
          fess.content.slice(0, 200)
        );
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

    return { image_url: upload.url, posted_to, ig_result };
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

/**
 * Bungkus bagian emoji dengan <tspan font-family="Twemoji Mozilla, Noto Emoji">.
 * Fontconfig minimal di runtime server tidak melakukan fallback antar-font untuk
 * glyph yang tidak ada di font teks, jadi emoji harus meminta font emoji eksplisit.
 */
function withEmojiFontSpan(line: string): string {
  if (!line) return '\u00A0';
  if (!line.match(EMOJI_SEQ_RE)) return escapeXml(line);
  return line
    .split(EMOJI_SEQ_RE)
    .map((part, i) =>
      i % 2 === 1 && part
        ? `<tspan font-family="Noto Emoji, Twemoji Mozilla, Noto Sans">${escapeXml(part)}</tspan>`
        : escapeXml(part)
    )
    .join('');
}

/**
 * Wrap text into SVG <text> element with <tspan> lines.
 * Uses character-count heuristic (no canvas measurement in Node).
 */
function buildTextLines(
  content: string,
  maxWidth: number,
  fontSize: number,
  lineHeightRatio: number,
  x: number,
  y: number,
  color: string
): string {
  const charsPerLine = Math.max(10, Math.floor(maxWidth / (fontSize * 0.55)));
  const lineHeightPx = Math.round(fontSize * lineHeightRatio);
  const maxLines = 12;

  const paragraphs = (content || '').split(/\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (lines.length >= maxLines) break;
    if (para.trim() === '') {
      lines.push('');
      continue;
    }
    const words = para.split(' ');
    let current = '';
    for (const word of words) {
      if (lines.length >= maxLines) break;
      const test = current ? `${current} ${word}` : word;
      if (test.length > charsPerLine && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current && lines.length < maxLines) lines.push(current);
  }

  // Add ellipsis if truncated
  if (lines.length === maxLines && content.length > lines.join(' ').length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.slice(0, -2) + '…';
  }

  const tspans = lines
    .map((line, i) =>
      `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeightPx}">${withEmojiFontSpan(line)}</tspan>`
    )
    .join('\n    ');

  return `<text x="${x}" y="${y}" font-family="Noto Sans, Arial, sans-serif" font-size="${fontSize}"
      font-weight="600" fill="${color}" xml:space="preserve">
    ${tspans}
  </text>`;
}
