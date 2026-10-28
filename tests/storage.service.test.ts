import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageService } from '../src/services/storage.service.js';
import { ENV } from '../src/config/env.js';

const { uploadMock, getPublicUrlMock, createSignedUploadUrlMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  getPublicUrlMock: vi.fn(),
  createSignedUploadUrlMock: vi.fn(),
}));

vi.mock('../src/config/supabase.js', () => ({
  getSupabase: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: uploadMock,
        getPublicUrl: getPublicUrlMock,
        createSignedUploadUrl: createSignedUploadUrlMock,
      })),
    },
  })),
}));

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'test_image.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: 1024 * 50,
    buffer: Buffer.from('fake image content'),
    destination: '',
    filename: '',
    path: '',
    stream: null as any,
    ...overrides,
  };
}

/** Jalankan fn dengan kredensial storage dikosongkan (mode dev tanpa storage). */
async function withoutStorage<T>(fn: () => Promise<T>): Promise<T> {
  const url = ENV.SUPABASE_URL;
  const key = ENV.SUPABASE_KEY;
  (ENV as any).SUPABASE_URL = 'https://dummy.supabase.co';
  (ENV as any).SUPABASE_KEY = 'dummy-supabase-key';
  try {
    return await fn();
  } finally {
    (ENV as any).SUPABASE_URL = url;
    (ENV as any).SUPABASE_KEY = key;
  }
}

describe('StorageService Unit Tests (Supabase Object Storage)', () => {
  beforeEach(() => {
    uploadMock.mockReset().mockResolvedValue({
      data: { path: 'media/test.jpg' },
      error: null,
    });
    getPublicUrlMock.mockReset().mockReturnValue({
      data: { publicUrl: 'https://supabase.co/storage/v1/object/public/confess-media/media/test.jpg' },
    });
    createSignedUploadUrlMock.mockReset();
  });

  it('should upload image media and return public URL', async () => {
    const result = await StorageService.uploadMedia(makeFile());

    expect(result.url).toBeDefined();
    expect(result.type).toBe('image');
    expect(result.size).toBe(1024 * 50);
    expect(result.url.startsWith('data:')).toBe(false);
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });

  it('should upload video media and return public URL with thumbnail', async () => {
    const file = makeFile({
      originalname: 'test_video.mp4',
      mimetype: 'video/mp4',
      size: 1024 * 500,
      buffer: Buffer.from('fake video content'),
    });

    const result = await StorageService.uploadMedia(file);
    expect(result.url).toBeDefined();
    expect(result.type).toBe('video');
    expect(result.thumbnail).toBeDefined();
  });

  it('should upload avatar and return image URL', async () => {
    const file = makeFile({
      originalname: 'avatar.png',
      mimetype: 'image/png',
      size: 1024 * 10,
      buffer: Buffer.from('fake avatar content'),
    });

    const url = await StorageService.uploadAvatar(file);
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });

  it('retries once and succeeds after a transient storage failure', async () => {
    uploadMock
      .mockResolvedValueOnce({ data: null, error: { message: '503 Service Unavailable' } })
      .mockResolvedValueOnce({ data: { path: 'media/retry.jpg' }, error: null });

    const result = await StorageService.uploadMedia(makeFile());

    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(result.url.startsWith('data:')).toBe(false);
    expect(result.url).toContain('supabase.co');
  });

  it('throws a clear error (no fake URL / data-URI) when storage keeps failing', async () => {
    uploadMock.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(StorageService.uploadMedia(makeFile())).rejects.toThrow(/Gagal mengunggah/);
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });

  it('uploads a buffer to a deterministic path (template thumbnail)', async () => {
    const buffer = Buffer.from('fake png content');
    const result = await StorageService.uploadBuffer({
      path: 'templates/01-helpdesk-ticket-v1.png',
      buffer,
      contentType: 'image/png',
    });

    expect(uploadMock).toHaveBeenCalledWith('templates/01-helpdesk-ticket-v1.png', buffer, {
      contentType: 'image/png',
      upsert: true,
    });
    expect(result.url).toContain('/object/public/');
    expect(result.size).toBe(buffer.length);
  });

  it('strips a leading slash from the buffer path', async () => {
    await StorageService.uploadBuffer({
      path: '/templates/02-network-map-v3.png',
      buffer: Buffer.from('png'),
    });

    expect(uploadMock).toHaveBeenCalledWith(
      'templates/02-network-map-v3.png',
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'application/octet-stream' })
    );
  });

  it('rejects an empty buffer path or payload', async () => {
    await expect(
      StorageService.uploadBuffer({ path: '', buffer: Buffer.from('png') })
    ).rejects.toThrow(/Path unggah/);
    await expect(
      StorageService.uploadBuffer({ path: 'templates/x.png', buffer: Buffer.alloc(0) })
    ).rejects.toThrow(/Buffer unggah kosong/);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('rejects uploadBuffer when storage is unconfigured', async () => {
    await withoutStorage(async () => {
      await expect(
        StorageService.uploadBuffer({ path: 'templates/x.png', buffer: Buffer.from('png') })
      ).rejects.toThrow(/Storage media belum dikonfigurasi/);
      expect(uploadMock).not.toHaveBeenCalled();
    });
  });

  it('throws (no fake URL) for oversized files when storage is unconfigured', async () => {
    await withoutStorage(async () => {
      const big = makeFile({ size: 3 * 1024 * 1024, buffer: Buffer.alloc(3 * 1024 * 1024) });

      await expect(StorageService.uploadMedia(big)).rejects.toThrow(/Storage media belum dikonfigurasi/);
      expect(uploadMock).not.toHaveBeenCalled();
    });
  });

  it('falls back to a data-URI for small files when storage is unconfigured', async () => {
    await withoutStorage(async () => {
      const result = await StorageService.uploadMedia(makeFile());

      expect(result.url.startsWith('data:image/jpeg;base64,')).toBe(true);
      expect(result.size).toBe(1024 * 50);
      expect(uploadMock).not.toHaveBeenCalled();
    });
  });

  it('creates a signed upload URL for direct client upload (video besar)', async () => {
    createSignedUploadUrlMock.mockResolvedValue({
      data: {
        signedUrl:
          'https://supabase.co/storage/v1/object/upload/sign/confess-media/media/big.mp4?token=abc',
        path: 'media/big.mp4',
        token: 'abc',
      },
      error: null,
    });

    const result = await StorageService.createSignedMediaUpload({
      filename: 'video-liburan.mp4',
      contentType: 'video/mp4',
    });

    expect(createSignedUploadUrlMock).toHaveBeenCalledTimes(1);
    expect(result.signed_url).toContain('/object/upload/sign/');
    expect(result.public_url).toContain('/object/public/');
    expect(result.type).toBe('video');
    expect(result.path).toMatch(/^media\/.*\.mp4$/);
  });

  it('throws a clear error when signed upload is requested without storage config', async () => {
    await withoutStorage(async () => {
      await expect(
        StorageService.createSignedMediaUpload({ filename: 'foto.jpg', contentType: 'image/jpeg' })
      ).rejects.toThrow(/Storage media belum dikonfigurasi/);
      expect(createSignedUploadUrlMock).not.toHaveBeenCalled();
    });
  });
});
