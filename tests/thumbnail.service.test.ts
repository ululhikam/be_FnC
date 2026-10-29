import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import { ENV } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import { StorageService } from '../src/services/storage.service.js';
import { fetchRemoteImage } from '../src/utils/remote-image.util.js';
import { ThumbnailService } from '../src/services/thumbnail.service.js';
import { AiService } from '../src/services/ai/ai.service.js';

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
  assertPublicHost: vi.fn().mockResolvedValue(undefined),
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

describe('ThumbnailService — komposisi foto penuh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Foto uji berwarna hijau tegas pada rasio tertentu (sharp asli). */
  async function greenPhoto(width: number, height: number): Promise<Buffer> {
    return sharp({
      create: { width, height, channels: 3, background: { r: 0, g: 160, b: 0 } },
    })
      .jpeg()
      .toBuffer();
  }

  async function render(width: number, height: number) {
    vi.mocked(fetchRemoteImage).mockResolvedValue({
      buffer: await greenPhoto(width, height),
      contentType: 'image/jpeg',
      finalUrl: 'https://cdn.test/foto.jpg',
    });
    const rendered = await ThumbnailService.renderCover(
      {
        id: 'preview',
        content: 'Kantin kampus tutup lebih awal padahal banyak yang belum makan',
        baseHandle: '@unermenfess',
        media,
        base: {
          id: 'base_1',
          name: 'UNERMEN FESS',
          thumbnailMode: 'no_ai',
          color: '#ff0055',
        },
      },
      'https://cdn.test/foto.jpg'
    );
    const { data, info } = await sharp(rendered.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
    };
    return { rendered, pixel };
  }

  it('foto memenuhi kartu — tidak ada pita judul di atas', async () => {
    const { pixel } = await render(1600, 900);
    // Sudut atas = foto (hijau), bukan pita warna base.
    const top = pixel(40, 60);
    expect(top.g).toBeGreaterThan(120);
    expect(top.r).toBeLessThan(60);
  });

  it('judul kecil berada di area bawah dengan scrim gelap', async () => {
    const { pixel } = await render(1600, 900);
    // Dasar kartu digelapkan agar teks putih terbaca di atas foto apa pun.
    const bottom = pixel(540, 1340);
    expect(bottom.r + bottom.g + bottom.b).toBeLessThan(200);
    // Bagian tengah foto tidak ikut digelapkan.
    const middle = pixel(540, 600);
    expect(middle.g).toBeGreaterThan(120);
  });

  it('tidak memakai blur pada foto utama', async () => {
    const { pixel } = await render(1600, 900);
    // Foto uji solid: kalau di-blur seluruhnya + brightness 0.72, hijaunya
    // turun drastis. Sharp tanpa blur mempertahankan warna asli.
    const middle = pixel(540, 600);
    expect(middle.g).toBeGreaterThan(140);
  });

  it('footer memakai dua pill rounded terpisah (handle & URL)', async () => {
    const { pixel } = await render(1600, 900);
    const brightness = (p: { r: number; g: number; b: number }) => (p.r + p.g + p.b) / 3;

    // Garis tepi atas tiap pill harus lebih terang dari isinya.
    const leftStroke = pixel(150, 1264);
    const leftFill = pixel(150, 1272);
    expect(brightness(leftStroke)).toBeGreaterThan(brightness(leftFill) + 30);

    const rightStroke = pixel(950, 1264);
    const rightFill = pixel(950, 1272);
    expect(brightness(rightStroke)).toBeGreaterThan(brightness(rightFill) + 30);
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

describe('ThumbnailService — judul cover dari AI', () => {
  const originalAiEnabled = ENV.AI_ENABLED;
  const originalTitleEnabled = ENV.AI_TITLE_ENABLED;

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
    ENV.AI_ENABLED = originalAiEnabled;
    ENV.AI_TITLE_ENABLED = originalTitleEnabled;
    vi.restoreAllMocks();
  });

  it('memakai judul AI untuk base mode auto dan menyimpan versi prompt', async () => {
    ENV.AI_ENABLED = true;
    ENV.AI_TITLE_ENABLED = true;
    const spy = vi.spyOn(AiService, 'generateTitle').mockResolvedValue({
      title: 'Kantin Tutup Lebih Awal',
      source: 'ai',
      promptVersion: 'v1',
      provider: 'gemini',
      model: 'gemini-test',
      latencyMs: 10,
    });

    const result = await ThumbnailService.ensure({
      id: 'fess_ai',
      content: 'Kantin kampus tutup lebih awal padahal banyak yang belum makan',
      baseHandle: '@unermenfess',
      media,
      base: { id: 'base_1', name: 'UNERMEN FESS', thumbnailMode: 'auto', bannedWords: ['bocor'] },
      topic: 'Kampus',
      tag: 'Cerita',
      thumbnailVersion: 0,
    });

    expect(result!.title).toBe('Kantin Tutup Lebih Awal');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        baseId: 'base_1',
        baseHandle: '@unermenfess',
        topic: 'Kampus',
        tag: 'Cerita',
        bannedWords: ['bocor'],
        targetId: 'fess_ai',
      })
    );
    expect(prisma.fess.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ thumbnailPromptVersion: 'v1' }),
      })
    );
  });

  it('tidak memanggil AI untuk base mode no_ai', async () => {
    ENV.AI_ENABLED = true;
    ENV.AI_TITLE_ENABLED = true;
    const spy = vi.spyOn(AiService, 'generateTitle');

    const result = await ThumbnailService.ensure({
      id: 'fess_noai',
      content: 'Kantin kampus tutup lebih awal',
      baseHandle: '@unermenfess',
      media,
      base: { id: 'base_1', name: 'Base', thumbnailMode: 'no_ai' },
      thumbnailVersion: 0,
    });

    expect(spy).not.toHaveBeenCalled();
    expect(prisma.fess.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ thumbnailPromptVersion: 'fallback' }),
      })
    );
  });

  it('jatuh ke judul deterministik bila AI mengembalikan fallback', async () => {
    ENV.AI_ENABLED = true;
    ENV.AI_TITLE_ENABLED = true;
    vi.spyOn(AiService, 'generateTitle').mockResolvedValue({
      title: 'Judul Deterministik',
      source: 'fallback',
      promptVersion: 'v1',
      latencyMs: 0,
    });

    await ThumbnailService.ensure({
      id: 'fess_fb',
      content: 'Kantin kampus tutup lebih awal',
      baseHandle: '@unermenfess',
      media,
      base: { id: 'base_1', thumbnailMode: 'auto' },
      thumbnailVersion: 0,
    });

    expect(prisma.fess.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ thumbnailPromptVersion: 'fallback' }),
      })
    );
  });

  it('tetap merender thumbnail bila pemanggilan AI melempar error', async () => {
    ENV.AI_ENABLED = true;
    ENV.AI_TITLE_ENABLED = true;
    vi.spyOn(AiService, 'generateTitle').mockRejectedValue(new Error('provider mati'));

    const result = await ThumbnailService.ensure({
      id: 'fess_err',
      content: 'Kantin kampus tutup lebih awal',
      baseHandle: '@unermenfess',
      media,
      base: { id: 'base_1', thumbnailMode: 'auto' },
      thumbnailVersion: 0,
    });

    expect(result).not.toBeNull();
    expect(result!.title.length).toBeGreaterThan(0);
    expect(StorageService.uploadBuffer).toHaveBeenCalledTimes(1);
  });

  it('tidak menulis ledger untuk pratinjau composer', async () => {
    ENV.AI_ENABLED = true;
    ENV.AI_TITLE_ENABLED = true;
    const spy = vi.spyOn(AiService, 'generateTitle').mockResolvedValue({
      title: 'Judul Pratinjau',
      source: 'ai',
      promptVersion: 'v1',
      latencyMs: 5,
    });

    await ThumbnailService.renderPreview({
      id: 'preview',
      content: 'Kantin kampus tutup lebih awal',
      baseHandle: '@unermenfess',
      media,
      base: { id: 'base_1', name: 'Base', thumbnailMode: 'auto' },
    });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ targetId: null }));
  });
});