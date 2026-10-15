import { describe, it, expect, vi } from 'vitest';
import { StorageService } from '../src/services/storage.service.js';

vi.mock('../src/config/supabase.js', () => ({
  getSupabase: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({
          data: { path: 'media/test.jpg' },
          error: null,
        }),
        getPublicUrl: vi.fn(() => ({
          data: { publicUrl: 'https://supabase.co/storage/v1/object/public/confess-media/media/test.jpg' },
        })),
      })),
    },
  })),
}));

describe('StorageService Unit Tests (Supabase Object Storage)', () => {
  it('should upload image media and return public URL', async () => {
    const file: Express.Multer.File = {
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
    };

    const result = await StorageService.uploadMedia(file);
    expect(result.url).toBeDefined();
    expect(result.type).toBe('image');
    expect(result.size).toBe(file.size);
  });

  it('should upload video media and return public URL with thumbnail', async () => {
    const file: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'test_video.mp4',
      encoding: '7bit',
      mimetype: 'video/mp4',
      size: 1024 * 500,
      buffer: Buffer.from('fake video content'),
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };

    const result = await StorageService.uploadMedia(file);
    expect(result.url).toBeDefined();
    expect(result.type).toBe('video');
    expect(result.thumbnail).toBeDefined();
  });

  it('should upload avatar and return image URL', async () => {
    const file: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'avatar.png',
      encoding: '7bit',
      mimetype: 'image/png',
      size: 1024 * 10,
      buffer: Buffer.from('fake avatar content'),
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };

    const url = await StorageService.uploadAvatar(file);
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });
});
