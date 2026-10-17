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
    fess: { findUnique: vi.fn(), update: vi.fn() },
    systemLog: { create: vi.fn() },
  },
}));

function mockConnection() {
  vi.mocked(prisma.base.findUnique).mockResolvedValue({
    igAccount: '@acc',
    creatorId: 'usr_1',
  } as any);
  vi.mocked(prisma.platformConnection.findUnique).mockResolvedValue({
    connected: true,
    accessToken: 'ig_token_real',
  } as any);
  vi.mocked(prisma.systemLog.create).mockResolvedValue({} as any);
  vi.mocked(prisma.fess.update).mockResolvedValue({} as any);
}

const FINALIZE_URL = '/internal/instagram/finalize';

describe('InstagramService carousel dengan media user (gambar + video)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnection();
  });

  it('semua gambar → carousel sinkron lalu publish', async () => {
    const postSpy = vi.mocked(axios.post);
    postSpy
      .mockResolvedValueOnce({ data: { id: 'item_1' } } as any)
      .mockResolvedValueOnce({ data: { id: 'item_2' } } as any)
      .mockResolvedValueOnce({ data: { id: 'car_1' } } as any)
      .mockResolvedValueOnce({ data: { id: 'media_1' } } as any);
    vi.mocked(axios.get).mockResolvedValue({ data: { status_code: 'FINISHED' } } as any);

    const result = await InstagramService.autoPostFess(
      '@acc',
      'fess_1',
      [
        { type: 'image', url: 'https://cdn.example.com/card.jpg' },
        { type: 'image', url: 'https://cdn.example.com/foto.jpg' },
      ],
      'Isi fess lengkap'
    );

    expect(result.meta_published).toBe(true);
    expect(result.ig_pending).toBe(false);
    expect(postSpy).toHaveBeenCalledTimes(4);

    const carouselParams = (postSpy.mock.calls[2][2] as any).params;
    expect(carouselParams).toMatchObject({
      media_type: 'CAROUSEL',
      children: 'item_1,item_2',
    });
    expect(carouselParams.caption).toContain('Isi fess lengkap');

    const publishParams = (postSpy.mock.calls[3][2] as any).params;
    expect(publishParams).toMatchObject({ creation_id: 'car_1' });
  });

  it('carousel dengan video → item dibuat (video lebih dulu), publish diserahkan ke worker', async () => {
    const postSpy = vi.mocked(axios.post);
    postSpy
      .mockResolvedValueOnce({ data: { id: 'vid_1' } } as any)
      .mockResolvedValueOnce({ data: { id: 'img_1' } } as any)
      .mockResolvedValueOnce({ data: { ok: true } } as any);

    const result = await InstagramService.autoPostFess(
      '@acc',
      'fess_2',
      [
        { type: 'image', url: 'https://cdn.example.com/card.jpg' },
        { type: 'video', url: 'https://cdn.example.com/klip.mp4' },
      ],
      'Isi fess video'
    );

    expect(result.ig_pending).toBe(true);
    expect(result.meta_published).toBe(false);
    expect(vi.mocked(axios.get)).not.toHaveBeenCalled();

    // Item video dibuat lebih dulu agar Meta memprosesnya lebih awal.
    const videoParams = (postSpy.mock.calls[0][2] as any).params;
    expect(videoParams).toMatchObject({
      video_url: 'https://cdn.example.com/klip.mp4',
      media_type: 'VIDEO',
      is_carousel_item: 'true',
    });
    const imageParams = (postSpy.mock.calls[1][2] as any).params;
    expect(imageParams).toMatchObject({ image_url: 'https://cdn.example.com/card.jpg' });

    // Publish diserahkan ke endpoint worker internal (HMAC-signed).
    const finalizeCall = postSpy.mock.calls[2];
    expect(String(finalizeCall[0])).toContain(FINALIZE_URL);
    const token = (finalizeCall[1] as any).token as string;
    const payload = InstagramService.verifyFinalizePayload(token);
    expect(payload).toMatchObject({
      fessId: 'fess_2',
      kind: 'carousel',
      itemIds: ['img_1', 'vid_1'],
      containerId: null,
    });

    expect(prisma.systemLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tone: 'ok' }) })
    );
  });

  it('video tunggal → container Reels dibuat, publish diserahkan ke worker', async () => {
    const postSpy = vi.mocked(axios.post);
    postSpy
      .mockResolvedValueOnce({ data: { id: 'reel_1' } } as any)
      .mockResolvedValueOnce({ data: { ok: true } } as any);

    const result = await InstagramService.autoPostFess(
      '@acc',
      'fess_3',
      [{ type: 'video', url: 'https://cdn.example.com/klip.mp4' }],
      'Video doang'
    );

    expect(result.ig_pending).toBe(true);
    expect(result.is_carousel).toBe(false);

    const reelParams = (postSpy.mock.calls[0][2] as any).params;
    expect(reelParams).toMatchObject({
      media_type: 'REELS',
      video_url: 'https://cdn.example.com/klip.mp4',
    });
    expect(reelParams.caption).toContain('Video doang');

    const token = (postSpy.mock.calls[1][1] as any).token as string;
    const payload = InstagramService.verifyFinalizePayload(token);
    expect(payload).toMatchObject({ kind: 'reels', containerId: 'reel_1', itemIds: null });
  });

  it('worker fase 2: tunggu container siap lalu publish + tandai postedToIg', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValue({
      id: 'fess_9',
      content: 'Isi fess dari DB',
      postedToIg: false,
    } as any);
    vi.mocked(axios.get).mockResolvedValue({ data: { status_code: 'FINISHED' } } as any);
    vi.mocked(axios.post).mockResolvedValueOnce({ data: { id: 'media_9' } } as any);

    await InstagramService.finalizeInstagramPost({
      fessId: 'fess_9',
      baseHandle: '@acc',
      kind: 'carousel',
      itemIds: null,
      containerId: 'car_9',
      attempts: 0,
      exp: Date.now() + 60_000,
    });

    const publishParams = (vi.mocked(axios.post).mock.calls[0][2] as any).params;
    expect(publishParams).toMatchObject({ creation_id: 'car_9' });
    expect(prisma.fess.update).toHaveBeenCalledWith({
      where: { id: 'fess_9' },
      data: { postedToIg: true },
    });
    expect(prisma.systemLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tone: 'ok',
          message: expect.stringContaining('berhasil dipublikasikan'),
        }),
      })
    );
  });

  it('worker fase 1: item siap → rakit carousel (caption dari DB) → publish', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValue({
      id: 'fess_5',
      content: 'Isi fess untuk carousel',
      postedToIg: false,
    } as any);
    vi.mocked(axios.get).mockResolvedValue({ data: { status_code: 'FINISHED' } } as any);
    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: { id: 'car_5' } } as any)
      .mockResolvedValueOnce({ data: { id: 'media_5' } } as any);

    await InstagramService.finalizeInstagramPost({
      fessId: 'fess_5',
      baseHandle: '@acc',
      kind: 'carousel',
      itemIds: ['i1', 'i2'],
      containerId: null,
      attempts: 0,
      exp: Date.now() + 60_000,
    });

    const carouselParams = (vi.mocked(axios.post).mock.calls[0][2] as any).params;
    expect(carouselParams).toMatchObject({ media_type: 'CAROUSEL', children: 'i1,i2' });
    expect(carouselParams.caption).toContain('Isi fess untuk carousel');
    expect(carouselParams.caption).toContain('(@acc)');
    expect(prisma.fess.update).toHaveBeenCalledWith({
      where: { id: 'fess_5' },
      data: { postedToIg: true },
    });
  });

  it('worker menjadwalkan ulang (reschedule) jika container belum siap', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValue({
      id: 'fess_6',
      content: 'Isi',
      postedToIg: false,
    } as any);
    vi.mocked(axios.get).mockResolvedValue({ data: { status_code: 'IN_PROGRESS' } } as any);
    vi.mocked(axios.post).mockResolvedValue({ data: { ok: true } } as any);

    await InstagramService.finalizeInstagramPost(
      {
        fessId: 'fess_6',
        baseHandle: '@acc',
        kind: 'carousel',
        itemIds: null,
        containerId: 'car_6',
        attempts: 0,
        exp: Date.now() + 60_000,
      },
      Date.now() + 1000 // deadline pendek untuk test
    );

    const finalizeCall = vi.mocked(axios.post).mock.calls[0];
    expect(String(finalizeCall[0])).toContain(FINALIZE_URL);
    const token = (finalizeCall[1] as any).token as string;
    const payload = InstagramService.verifyFinalizePayload(token);
    expect(payload).toMatchObject({ containerId: 'car_6', attempts: 1 });
    expect(prisma.fess.update).not.toHaveBeenCalled();
    expect(prisma.systemLog.create).not.toHaveBeenCalled();
  });

  it('payload finalize ditandatangani & tervalidasi (anti tamper)', () => {
    const payload = {
      fessId: 'fess_x',
      baseHandle: '@acc',
      kind: 'carousel' as const,
      itemIds: ['a'],
      containerId: null,
      attempts: 0,
      exp: Date.now() + 60_000,
    };

    const token = InstagramService.signFinalizePayload(payload);
    expect(InstagramService.verifyFinalizePayload(token)).toMatchObject(payload);

    const tampered = `${token.slice(0, -3)}abc`;
    expect(InstagramService.verifyFinalizePayload(tampered)).toBeNull();
    expect(InstagramService.verifyFinalizePayload('bukan-token')).toBeNull();

    const expired = InstagramService.signFinalizePayload({ ...payload, exp: Date.now() - 1000 });
    expect(InstagramService.verifyFinalizePayload(expired)).toBeNull();
  });
});
