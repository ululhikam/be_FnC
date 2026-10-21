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
    vi.mocked(prisma.fess.update).mockResolvedValue({} as any);
  });

  it('should throw error if fess to export does not exist', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce(null);

    await expect(CanvasService.exportFessCanvas('non_existent')).rejects.toThrow('tidak ditemukan');
  });

  it('ekspor non-portrait (story) hanya menghasilkan gambar, tanpa auto-post/ubah status IG', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_story',
      baseHandle: '@codememfess',
      content: 'Ekspor story admin',
      template: 'midnight',
      base: { name: 'Code & Memes Base', initial: 'CM' },
    } as any);

    const result = await CanvasService.exportFessCanvas('fess_story', 'midnight', 'story');

    expect(result.image_url).toContain('https://storage.supabase.co');
    expect(result.posted_to).toEqual([]);
    expect(result.ig_result).toMatchObject({ skipped: true, meta_published: false });
    expect(InstagramService.autoPostFess).not.toHaveBeenCalled();
    expect(prisma.fess.update).not.toHaveBeenCalled();
  });

  it('ekspor admin (autoPost:false) merender portrait tanpa posting/ubah status IG', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_export',
      baseHandle: '@codememfess',
      content: 'Unduh card saja',
      template: 'midnight',
      base: { name: 'Code & Memes Base', initial: 'CM' },
    } as any);

    const result = await CanvasService.exportFessCanvas('fess_export', 'midnight', 'portrait', {
      autoPost: false,
    });

    expect(result.image_url).toContain('https://storage.supabase.co');
    expect(result.posted_to).toEqual([]);
    expect(InstagramService.autoPostFess).not.toHaveBeenCalled();
    expect(prisma.fess.update).not.toHaveBeenCalled();
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

    const result = await CanvasService.exportFessCanvas('fess_101', 'midnight', 'portrait');

    expect(result.image_url).toContain('https://storage.supabase.co');
    expect(result.posted_to).toContain('instagram');
    // Instagram hanya menerima JPEG — kartu canvas harus diunggah sebagai .jpg
    const uploadedFile = vi.mocked(StorageService.uploadMedia).mock.calls[0][0] as any;
    expect(uploadedFile.mimetype).toBe('image/jpeg');
    expect(uploadedFile.originalname).toMatch(/\.jpg$/);
    expect(prisma.fess.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fess_101' },
        data: expect.objectContaining({ postedToIg: true, igStatus: 'published' }),
      })
    );
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
      {
        type: 'image',
        url: 'https://storage.supabase.co/confess-media/canvas_export.svg',
        width: 1080,
        height: 1350,
        normalized: true,
      },
      { type: 'image', url: 'https://cdn.example.com/foto.png' },
      { type: 'video', url: 'https://cdn.example.com/klip.mp4' },
    ]);
    expect(result.card_count).toBe(1);
    expect(result.media_count).toBe(2);
  });

  it('mengikuti carouselOrder: media bisa menjadi slide pertama', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_order',
      baseHandle: '@codememfess',
      content: 'Urutan carousel bebas',
      template: 'default',
      carouselOrder: ['media:media_b', 'card:0', 'media:media_a'],
      media: [
        { id: 'media_a', type: 'image', url: 'https://cdn.example.com/a.png' },
        { id: 'media_b', type: 'image', url: 'https://cdn.example.com/b.png' },
      ],
      base: { name: 'Base', initial: 'MB' },
    } as any);

    await CanvasService.exportFessCanvas('fess_order', 'default', 'portrait');

    const autoPostMock = vi.mocked(InstagramService.autoPostFess);
    const itemsArg = autoPostMock.mock.calls[0][2] as any[];
    expect(itemsArg.map((item) => ({ type: item.type, url: item.url }))).toEqual([
      { type: 'image', url: 'https://cdn.example.com/b.png' },
      { type: 'image', url: 'https://storage.supabase.co/confess-media/canvas_export.svg' },
      { type: 'image', url: 'https://cdn.example.com/a.png' },
    ]);
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
      // Semua template wajib 4:5 — tidak boleh ada card persegi/story.
      expect(svgs[0]).toContain('width="1080" height="1350"');
      expect(TEMPLATES.find((t) => t.key === key)?.aspect).toBe('portrait');
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

  it('merender foto profil base dan chip topik di kartu', () => {
    const avatar =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#ff0066"/></svg>'
      );

    const [svg] = CanvasService.buildSvgPages(
      {
        baseHandle: '@cintafess',
        content: 'Kartu dengan foto profil base dan topik.',
        topic: 'cinta',
        template: 'default',
        base: {
          name: 'Cinta Base',
          initial: 'CB',
          avatar,
          avatarDataUri: avatar,
        },
      } as any,
      'default'
    );

    expect(svg).toContain('<clipPath id="avatarClip">');
    expect(svg).toContain('href="' + avatar + '"');
    expect(svg).toContain('>Cinta</text>');
    expect(svg).not.toContain('>CB</text>');
    expect(CanvasService.renderSvgToPng(svg).length).toBeGreaterThan(100);
  });

  it('tetap memakai inisial bila base tidak punya foto profil', () => {
    const [svg] = CanvasService.buildSvgPages(
      {
        baseHandle: '@cintafess',
        content: 'Kartu tanpa foto profil.',
        template: 'default',
        base: { name: 'Cinta Base', initial: 'CB', avatar: 'CB' },
      } as any,
      'default'
    );

    expect(svg).not.toContain('<clipPath id="avatarClip">');
    expect(svg).toContain('>CB</text>');
  });

  it('should render the 20 new templates full-bleed with scaled textures', () => {
    const fullBleed = TEMPLATES.filter((t) => t.panel && t.pattern).map((t) => t.key);
    expect(fullBleed.length).toBe(20);

    for (const key of fullBleed) {
      const svgs = CanvasService.buildSvgPages(
        {
          baseHandle: '@techfess',
          content: 'Full bleed template',
          template: key,
          base: { name: 'Tech & Modern Base', initial: 'TM' },
        } as any,
        key
      );
      expect(svgs[0]).toContain('patternTransform="scale(5)"');
      expect(svgs[0]).not.toContain('<!-- Card panel -->');
    }

    // Template lama tetap memakai panel kartu seperti sebelumnya.
    const legacy = CanvasService.buildSvgPages(
      {
        baseHandle: '@techfess',
        content: 'Legacy panel template',
        template: 'midnight',
        base: { name: 'Tech & Modern Base', initial: 'TM' },
      } as any,
      'midnight'
    );
    expect(legacy[0]).toContain('<!-- Card panel -->');
  });
});
