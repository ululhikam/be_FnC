import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanvasService } from '../src/services/canvas.service.js';
import { prisma } from '../src/config/prisma.js';

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
    autoPostFess: vi.fn().mockResolvedValue({ success: true, platform: 'instagram' }),
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
    expect(prisma.fess.update).toHaveBeenCalledWith({
      where: { id: 'fess_101' },
      data: { postedToIg: true },
    });
  });
});
