import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import { CanvasService } from '../src/services/canvas.service.js';
import { InstagramService } from '../src/services/instagram.service.js';
import { StorageService } from '../src/services/storage.service.js';
import { prisma } from '../src/config/prisma.js';
import { ENV } from '../src/config/env.js';
import { fetchRemoteImage } from '../src/utils/remote-image.util.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    fess: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    systemLog: { create: vi.fn().mockResolvedValue({}) },
    template: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock('../src/services/storage.service.js', () => ({
  StorageService: {
    uploadMedia: vi.fn().mockResolvedValue({
      url: 'https://storage.supabase.co/confess-media/card.jpg',
      size: 1024,
      type: 'image',
    }),
    uploadBuffer: vi.fn().mockResolvedValue({
      url: 'https://storage.supabase.co/confess-media/canvas-thumbnails/fess_thumb.jpg',
      path: 'canvas-thumbnails/fess_thumb.jpg',
      size: 2048,
    }),
  },
}));

vi.mock('../src/services/instagram.service.js', () => ({
  InstagramService: {
    autoPostFess: vi.fn().mockResolvedValue({
      success: true,
      platform: 'instagram',
      meta_published: true,
      items: [],
    }),
  },
}));

vi.mock('../src/utils/remote-image.util.js', () => ({
  fetchRemoteImage: vi.fn(),
  isPublicHttpUrl: vi.fn().mockReturnValue(true),
}));

const originalEnabled = ENV.THUMBNAIL_ENABLED;

describe('CanvasService + thumbnail cover', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ENV.THUMBNAIL_ENABLED = true;
    vi.mocked(prisma.fess.update).mockResolvedValue({} as any);
    vi.mocked(fetchRemoteImage).mockImplementation(async () => ({
      buffer: await sharp({
        create: { width: 600, height: 800, channels: 3, background: { r: 20, g: 60, b: 120 } },
      })
        .jpeg()
        .toBuffer(),
      contentType: 'image/jpeg',
      finalUrl: 'https://cdn.test/foto.jpg',
    }));
  });

  afterEach(() => {
    ENV.THUMBNAIL_ENABLED = originalEnabled;
  });

  it('menaruh thumbnail di indeks 0 dan menyimpannya di igPayload sebelum auto-post', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_thumb',
      baseHandle: '@codememfess',
      content: 'Kantin tutup lebih awal padahal belum sarapan',
      template: 'default',
      media: [
        { id: 'img_a', type: 'image', url: 'https://cdn.test/a.jpg' },
        { id: 'img_b', type: 'image', url: 'https://cdn.test/b.jpg' },
      ],
      base: { name: 'Base', initial: 'MB', thumbnailMode: 'auto' },
    } as any);

    const result = await CanvasService.exportFessCanvas('fess_thumb', 'default', 'portrait');

    const thumbnailUrl =
      'https://storage.supabase.co/confess-media/canvas-thumbnails/fess_thumb.jpg';
    expect(result.thumbnail_url).toContain(thumbnailUrl);
    expect(result.thumbnail_title).toBeTruthy();

    // Payload retry (persistIgState) harus sudah memuat thumbnail.
    const payloadCall = vi
      .mocked(prisma.fess.update)
      .mock.calls.find((call) => (call[0] as any)?.data?.igPayload);
    const payloadItems = (payloadCall?.[0] as any).data.igPayload.items;
    expect(payloadItems[0].url).toContain(thumbnailUrl);
    expect(payloadItems.length).toBeLessThanOrEqual(10);

    // Auto-post menerima urutan yang sama.
    const itemsArg = vi.mocked(InstagramService.autoPostFess).mock.calls[0][2] as any[];
    expect(itemsArg[0].url).toContain(thumbnailUrl);
    expect(itemsArg[0].width).toBe(1080);
    expect(itemsArg[0].height).toBe(1350);
    // Media user tidak boleh terpotong.
    expect(itemsArg.map((item) => item.url)).toEqual(
      expect.arrayContaining(['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'])
    );
  });

  it('tidak menambahkan slide cover saat base opt-out', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_no_thumb',
      baseHandle: '@codememfess',
      content: 'Base mematikan thumbnail',
      template: 'default',
      media: [{ id: 'img_a', type: 'image', url: 'https://cdn.test/a.jpg' }],
      base: { name: 'Base', initial: 'MB', thumbnailMode: 'off' },
    } as any);

    const result = await CanvasService.exportFessCanvas('fess_no_thumb', 'default', 'portrait');

    expect(result.thumbnail_url).toBeUndefined();
    expect(StorageService.uploadBuffer).not.toHaveBeenCalled();
    const itemsArg = vi.mocked(InstagramService.autoPostFess).mock.calls[0][2] as any[];
    expect(itemsArg[0].url).toContain('https://storage.supabase.co/confess-media/card.jpg');
  });
});