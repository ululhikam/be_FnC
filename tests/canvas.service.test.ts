import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanvasService } from '../src/services/canvas.service.js';
import { InstagramService } from '../src/services/instagram.service.js';
import { StorageService } from '../src/services/storage.service.js';
import { prisma } from '../src/config/prisma.js';
import { TEMPLATES } from '../src/constants/templates.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    fess: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    systemLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../src/services/storage.service.js', () => ({
  StorageService: {
    uploadMedia: vi.fn().mockResolvedValue({
      url: 'https://storage.supabase.co/confess-media/canvas_export.svg',
      size: 1024,
      type: 'image',
    }),
  },
}));

vi.mock('../src/services/instagram.service.js', () => ({
  InstagramService: {
    autoPostFess: vi.fn().mockResolvedValue({ success: true, platform: 'instagram', meta_published: true }),
  },
}));

describe('CanvasService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw error if fess to export does not exist', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce(null);

    await expect(CanvasService.exportFessCanvas('non_existent')).rejects.toThrow('tidak ditemukan');
  });

  it('should export canvas with chosen template and aspect ratio and trigger auto-post', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_101',
      baseHandle: '@codememfess',
      content: 'Testing canvas generation for Instagram story',
      template: 'midnight',
      base: {
        name: 'Code & Memes Base',
        initial: 'CM',
      },
    } as any);

    const result = await CanvasService.exportFessCanvas('fess_101', 'midnight', 'story');

    expect(result.image_url).toContain('https://storage.supabase.co');
    expect(result.posted_to).toContain('instagram');
    // Instagram hanya menerima JPEG — kartu canvas harus diunggah sebagai .jpg
    const uploadedFile = vi.mocked(StorageService.uploadMedia).mock.calls[0][0] as any;
    expect(uploadedFile.mimetype).toBe('image/jpeg');
    expect(uploadedFile.originalname).toMatch(/\.jpg$/);
    expect(prisma.fess.update).toHaveBeenCalledWith({
      where: { id: 'fess_101' },
      data: { postedToIg: true },
    });
  });

  it('should append user media (image/video, MP4 only) to the Instagram post items', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_media',
      baseHandle: '@codememfess',
      content: 'Fess dengan media user',
      template: 'default',
      media: [
        { type: 'image', url: 'https://cdn.example.com/foto.png' },
        { type: 'video', url: 'https://cdn.example.com/klip.mp4' },
        { type: 'video', url: 'https://cdn.example.com/klip.webm' },
        { type: 'image', url: 'data:image/png;base64,xxxx' },
      ],
      base: { name: 'Base', initial: 'MB' },
    } as any);

    const result = await CanvasService.exportFessCanvas('fess_media', 'default', 'portrait');

    const autoPostMock = vi.mocked(InstagramService.autoPostFess);
    expect(autoPostMock).toHaveBeenCalledTimes(1);
    const itemsArg = autoPostMock.mock.calls[0][2] as any[];
    expect(itemsArg).toEqual([
      { type: 'image', url: 'https://storage.supabase.co/confess-media/canvas_export.svg' },
      { type: 'image', url: 'https://cdn.example.com/foto.png' },
      { type: 'video', url: 'https://cdn.example.com/klip.mp4' },
    ]);
    expect(result.card_count).toBe(1);
    expect(result.media_count).toBe(2);
  });

  it('should send the full fess content as caption (truncation handled by InstagramService)', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_caption',
      baseHandle: '@codememfess',
      content: 'A'.repeat(2500),
      template: 'default',
      base: { name: 'Base', initial: 'MB' },
    } as any);

    await CanvasService.exportFessCanvas('fess_caption', 'default', 'portrait');

    const autoPostMock = vi.mocked(InstagramService.autoPostFess);
    const captionArg = autoPostMock.mock.calls[0][3] as string;
    expect(captionArg).toBe('A'.repeat(2500));
  });

  it('should build SVG for every template and render each font family', () => {
    const templates = TEMPLATES.map((t) => t.key);
    expect(templates.length).toBe(38);

    for (const key of templates) {
      const svgs = CanvasService.buildSvgPages(
        {
          baseHandle: '@techfess',
          content: `Test confession with template: ${key}`,
          template: key,
          base: { name: 'Tech & Modern Base', initial: 'TM' },
        } as any,
        key
      );

      expect(svgs.length).toBeGreaterThanOrEqual(1);
      expect(svgs[0]).toContain('<svg');
      expect(svgs[0]).toContain('bgPattern');
      expect(svgs[0]).toContain('Tech &amp; Modern Base');
    }

    // Render satu wakil per keluarga font: sans, display, serif, mono.
    for (const key of ['cyberpunk', 'sunburst', 'newsprint', 'railway']) {
      const svgs = CanvasService.buildSvgPages(
        {
          baseHandle: '@techfess',
          content: `Font render check: ${key}`,
          template: key,
          base: { name: 'Tech & Modern Base', initial: 'TM' },
        } as any,
        key
      );
      const png = CanvasService.renderSvgToPng(svgs[0]);
      expect(png.length).toBeGreaterThan(100);
    }
  });
});
