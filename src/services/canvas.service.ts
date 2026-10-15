import { ASPECTS, getTemplateByKey } from '../constants/templates.js';
import { StorageService } from './storage.service.js';
import { prisma } from '../config/prisma.js';
import { InstagramService } from './instagram.service.js';

export interface CanvasExportResult {
  image_url: string;
  posted_to: ('instagram' | 'twitter' | 'telegram')[];
}

export class CanvasService {
  /**
   * Render confession to an image URL matching template and aspect ratio
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

    const template = getTemplateByKey(templateKey);
    const aspect = ASPECTS[aspectKey] || ASPECTS.portrait;

    // Generate high quality SVG representation of the card
    const svgCard = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${aspect.width}" height="${aspect.height}" viewBox="0 0 ${aspect.width} ${aspect.height}">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0038ff" />
            <stop offset="55%" stop-color="#4b1fff" />
            <stop offset="100%" stop-color="#7000ff" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg)" />
        <rect x="60" y="80" width="${aspect.width - 120}" height="${aspect.height - 160}" rx="32" fill="rgba(255, 255, 255, 0.08)" stroke="rgba(255, 255, 255, 0.2)" stroke-width="2" />
        
        <!-- Header -->
        <circle cx="130" cy="160" r="36" fill="${template.accent}" opacity="0.3" />
        <text x="130" y="172" font-family="sans-serif" font-size="28" font-weight="bold" fill="#ffffff" text-anchor="middle">
          ${fess.base?.initial || 'FH'}
        </text>
        <text x="190" y="155" font-family="sans-serif" font-size="32" font-weight="bold" fill="#ffffff">
          ${escapeXml(fess.base?.name || fess.baseHandle)}
        </text>
        <text x="190" y="185" font-family="sans-serif" font-size="24" fill="rgba(255,255,255,0.7)">
          ${escapeXml(fess.baseHandle)} • FessHub
        </text>

        <!-- Content -->
        <foreignObject x="100" y="240" width="${aspect.width - 200}" height="${aspect.height - 440}">
          <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: sans-serif; font-size: 38px; line-height: 1.5; color: #ffffff; word-wrap: break-word;">
            ${escapeXml(fess.content)}
          </div>
        </foreignObject>

        <!-- Footer -->
        <text x="100" y="${aspect.height - 120}" font-family="sans-serif" font-size="24" fill="rgba(255,255,255,0.6)">
          Diterbitkan melalui FessHub • Instagram Story Auto-Post
        </text>
      </svg>
    `;

    const buffer = Buffer.from(svgCard, 'utf-8');
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: `canvas_${fessId}_${templateKey}_${aspectKey}.svg`,
      encoding: '7bit',
      mimetype: 'image/svg+xml',
      size: buffer.length,
      buffer,
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };

    const upload = await StorageService.uploadMedia(mockFile, 'canvas-exports');

    // Auto-post trigger simulation to connected platforms
    const posted_to: ('instagram' | 'twitter' | 'telegram')[] = ['instagram'];

    // Call Instagram auto-post handler
    await InstagramService.autoPostFess(
      fess.baseHandle,
      fess.id,
      upload.url,
      fess.content.slice(0, 100)
    );

    // Update fess postedToIg flag
    await prisma.fess.update({
      where: { id: fessId },
      data: { postedToIg: true },
    });

    return {
      image_url: upload.url,
      posted_to,
    };
  }
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
