import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { InstagramService } from '../src/services/instagram.service.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    base: { findUnique: vi.fn() },
    platformConnection: { findUnique: vi.fn() },
    systemLog: { create: vi.fn() },
  },
}));

describe('InstagramService carousel dengan media user (gambar + video)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.base.findUnique).mockResolvedValue({
      igAccount: '@acc',
      creatorId: 'usr_1',
    } as any);
    vi.mocked(prisma.platformConnection.findUnique).mockResolvedValue({
      connected: true,
      accessToken: 'ig_token_real',
    } as any);
    vi.mocked(prisma.systemLog.create).mockResolvedValue({} as any);
  });

  it('membuat item video carousel lalu menerbitkan container CAROUSEL', async () => {
    const postSpy = vi.mocked(axios.post);
    postSpy
      .mockResolvedValueOnce({ data: { id: 'item_img_1' } } as any)
      .mockResolvedValueOnce({ data: { id: 'item_vid_2' } } as any)
      .mockResolvedValueOnce({ data: { id: 'carousel_1' } } as any)
      .mockResolvedValueOnce({ data: { id: 'media_1' } } as any);
    vi.mocked(axios.get).mockResolvedValue({ data: { status_code: 'FINISHED' } } as any);

    const result = await InstagramService.autoPostFess(
      '@acc',
      'fess_9',
      [
        { type: 'image', url: 'https://cdn.example.com/card.png' },
        { type: 'video', url: 'https://cdn.example.com/klip.mp4' },
      ],
      'Isi fess lengkap'
    );

    expect(result.meta_published).toBe(true);
    expect(result.is_carousel).toBe(true);

    const firstParams = (postSpy.mock.calls[0][2] as any).params;
    expect(firstParams).toMatchObject({
      image_url: 'https://cdn.example.com/card.png',
      is_carousel_item: 'true',
    });

    const secondParams = (postSpy.mock.calls[1][2] as any).params;
    expect(secondParams).toMatchObject({
      video_url: 'https://cdn.example.com/klip.mp4',
      media_type: 'VIDEO',
      is_carousel_item: 'true',
    });

    const carouselParams = (postSpy.mock.calls[2][2] as any).params;
    expect(carouselParams).toMatchObject({
      media_type: 'CAROUSEL',
      children: 'item_img_1,item_vid_2',
    });
    expect(carouselParams.caption).toContain('Isi fess lengkap');
    expect(carouselParams.caption).toContain('(@acc)');

    const publishParams = (postSpy.mock.calls[3][2] as any).params;
    expect(publishParams).toMatchObject({ creation_id: 'carousel_1' });
  });

  it('menerbitkan video tunggal sebagai Reels', async () => {
    const postSpy = vi.mocked(axios.post);
    postSpy
      .mockResolvedValueOnce({ data: { id: 'reel_1' } } as any)
      .mockResolvedValueOnce({ data: { id: 'media_2' } } as any);
    vi.mocked(axios.get).mockResolvedValue({ data: { status_code: 'FINISHED' } } as any);

    const result = await InstagramService.autoPostFess(
      '@acc',
      'fess_10',
      [{ type: 'video', url: 'https://cdn.example.com/klip.mp4' }],
      'Video doang'
    );

    expect(result.meta_published).toBe(true);
    expect(result.is_carousel).toBe(false);

    const reelParams = (postSpy.mock.calls[0][2] as any).params;
    expect(reelParams).toMatchObject({
      media_type: 'REELS',
      video_url: 'https://cdn.example.com/klip.mp4',
    });
  });
});
