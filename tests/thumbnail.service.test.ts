import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import { ENV } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import { StorageService } from '../src/services/storage.service.js';
import { fetchRemoteImage } from '../src/utils/remote-image.util.js';
import { ThumbnailService } from '../src/services/thumbnail.service.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    fess: { update: vi.fn().mockResolvedValue({}) },
    systemLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

const uploaded: Buffer[] = [];

vi.mock('../src/services/storage.service.js', () => ({
  StorageService: {
    uploadBuffer: vi.fn(async (input: { path: string; buffer: Buffer; contentType?: string }) => {
      uploaded.push(input.buffer);
      return {
        url: `https://storage.test/${input.path}`,
        path: input.path,
        size: input.buffer.length,
      };
    }),
  },
}));

vi.mock('../src/utils/remote-image.util.js', () => ({
  fetchRemoteImage: vi.fn(),
  isPublicHttpUrl: vi.fn().mockReturnValue(true),
}));

const originalEnabled = ENV.THUMBNAIL_ENABLED;

/** Foto uji 800×1000 solid (sharp asli, tanpa jaringan). */
async function samplePhoto(color = { r: 30, g: 90, b: 190 }): Promise<Buffer> {
  return sharp({
    create: { width: 800, height: 1000, channels: 3, background: color },
  })
    .jpeg()
    .toBuffer();
}

const media = [{ id: 'media_1', type: 'image', url: 'https://cdn.test/foto.jpg' }];

describe('ThumbnailService.ensure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploaded.length = 0;
    ENV.THUMBNAIL_ENABLED = true;
    vi.mocked(fetchRemoteImage).mockImplementation(async () => ({
      buffer: await samplePhoto(),
      contentType: 'image/jpeg',
      finalUrl: 'https://cdn.test/foto.jpg',
    }));
    vi.mocked(prisma.fess.update).mockResolvedValue({} as any);
  });

  afterEach(() => {
    ENV.THUMBNAIL_ENABLED = originalEnabled;
  });

  it('merender JPEG 1080×1350, mengunggah, dan menyimpan status ready', async () => {
    const result = await ThumbnailService.ensure({
      id: 'fess_1',
      content: 'Kantin tutup lebih awal padahal lapar',
      baseHandle: '@unermenfess',
      media,
      base: { name: 'UNERMEN FESS', thumbnailMode: 'auto' },
      thumbnailVersion: 0,
    });

    expect(result).not.toBeNull();
    expect(result!.sourceMediaId).toBe('media_1');
    expect(result!.url).toContain('canvas-thumbnails/fess_1.jpg');
    expect(result!.url).toContain('v=1');
    expect(result!.title.split(' ').length).toBeLessThanOrEqual(5);

    const jpeg = uploaded[0];
    const meta = await sharp(jpeg).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);

    expect(prisma.fess.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fess_1' },
        data: expect.objectContaining({
          thumbnailStatus: 'ready',
          thumbnailSourceMediaId: 'media_1',
          thumbnailPromptVersion: 'fallback',
          thumbnailVersion: 1,
        }),
      })
    );
  });

  it('memakai ulang thumbnail ready untuk foto yang sama (tanpa render baru)', async () => {
    const result = await ThumbnailService.ensure({
      id: 'fess_2',
      content: 'Konten apa saja',
      baseHandle: '@base',
      media,
      base: { thumbnailMode: 'auto' },
      thumbnailUrl: 'https://storage.test/canvas-thumbnails/fess_2.jpg?v=3',
      thumbnailStatus: 'ready',
      thumbnailSourceMediaId: 'media_1',
      thumbnailTitle: 'Judul Lama',
      thumbnailVersion: 3,
    });

    expect(result).toMatchObject({
      url: 'https://storage.test/canvas-thumbnails/fess_2.jpg?v=3',
      title: 'Judul Lama',
      version: 3,
    });
    expect(fetchRemoteImage).not.toHaveBeenCalled();
    expect(StorageService.uploadBuffer).not.toHaveBeenCalled();
  });

  it('menghormati opt-out base dan kill switch', async () => {
    await expect(
      ThumbnailService.ensure({
        id: 'fess_off',
        content: 'Konten',
        baseHandle: '@base',
        media,
        base: { thumbnailMode: 'off' },
      })
    ).resolves.toBeNull();

    ENV.THUMBNAIL_ENABLED = false;
    await expect(
      ThumbnailService.ensure({
        id: 'fess_off',
        content: 'Konten',
        baseHandle: '@base',
        media,
        base: { thumbnailMode: 'auto' },
      })
    ).resolves.toBeNull();
    expect(fetchRemoteImage).not.toHaveBeenCalled();
  });

  it('tidak membuat thumbnail bila hanya ada video', async () => {
    const result = await ThumbnailService.ensure({
      id: 'fess_video',
      content: 'Konten',
      baseHandle: '@base',
      media: [{ id: 'vid', type: 'video', url: 'https://cdn.test/video.mp4' }],
      base: { thumbnailMode: 'auto' },
    });
    expect(result).toBeNull();
    expect(fetchRemoteImage).not.toHaveBeenCalled();
  });

  it('gagal mengambil foto → status failed, publish tidak ikut gagal', async () => {
    vi.mocked(fetchRemoteImage).mockRejectedValueOnce(new Error('timeout'));

    const result = await ThumbnailService.ensure({
      id: 'fess_fail',
      content: 'Konten',
      baseHandle: '@base',
      media,
      base: { thumbnailMode: 'auto' },
    });

    expect(result).toBeNull();
    expect(prisma.fess.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fess_fail' },
        data: expect.objectContaining({ thumbnailStatus: 'failed', thumbnailError: 'timeout' }),
      })
    );
  });
});

describe('ThumbnailService.renderPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ENV.THUMBNAIL_ENABLED = true;
    vi.mocked(fetchRemoteImage).mockImplementation(async () => ({
      buffer: await samplePhoto({ r: 240, g: 230, b: 200 }),
      contentType: 'image/jpeg',
      finalUrl: 'https://cdn.test/foto.jpg',
    }));
  });

  afterEach(() => {
    ENV.THUMBNAIL_ENABLED = originalEnabled;
  });

  it('mengembalikan PNG data URI tanpa upload/persist', async () => {
    const result = await ThumbnailService.renderPreview({
      id: 'preview',
      content: 'Judul pratinjau cover',
      baseHandle: '@base',
      media,
      base: { name: 'Base', thumbnailMode: 'auto' },
    });

    expect(result?.dataUri).toMatch(/^data:image\/png;base64,/);
    const png = Buffer.from(result!.dataUri.split(',')[1], 'base64');
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);
    expect(StorageService.uploadBuffer).not.toHaveBeenCalled();
    expect(prisma.fess.update).not.toHaveBeenCalled();
  });
});