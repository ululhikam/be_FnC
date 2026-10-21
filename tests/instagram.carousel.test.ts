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

// Normalisasi gambar diuji terpisah di instagram.media.util.test.ts; di sini
// fokus pada alur carousel Meta.
vi.mock('../src/utils/instagram-media.util.js', () => ({
  IG_CAROUSEL_TARGET: { width: 1080, height: 1350 },
  ensureIgImageUrl: vi.fn(async (url: string) => ({ url, width: 1080, height: 1350 })),
  assertCarouselGeometry: vi.fn(),
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
  // Default axios.get: cek kuota normal + status container FINISHED.
  // Test bisa menimpanya dengan mockResolvedValue(Once) miliknya sendiri.
  vi.mocked(axios.get).mockImplementation(async (url: string) => {
    if (String(url).includes('content_publishing_limit')) {
      return { data: { data: [{ quota_usage: 0, config: { quota_total: 100 } }] } } as any;
    }
    return { data: { status_code: 'FINISHED' } } as any;
  });
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

    // Payload final untuk retry/admin: setiap item carousel wajib 1080×1350.
    const payloadCall = vi
      .mocked(prisma.fess.update)
      .mock.calls.map((call) => call[0] as any)
      .find((arg) => Array.isArray(arg?.data?.igPayload?.items));
    const payloadItems = payloadCall?.data?.igPayload?.items || [];
    expect(payloadItems).toHaveLength(2);
    expect(payloadItems.map((item: any) => `${item.width}×${item.height}`)).toEqual([
      '1080×1350',
      '1080×1350',
    ]);
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
        {
          type: 'video',
          url: 'https://cdn.example.com/klip.mp4',
          width: 1080,
          height: 1350,
          duration: 20,
        },
      ],
      'Isi fess video'
    );

    expect(result.ig_pending).toBe(true);
    expect(result.meta_published).toBe(false);
    // Hanya cek kuota — tidak ada polling status container (publish diserahkan worker).
    const getCalls = vi.mocked(axios.get).mock.calls;
    expect(getCalls.length).toBe(1);
    expect(String(getCalls[0][0])).toContain('content_publishing_limit');

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
      [
        {
          type: 'video',
          url: 'https://cdn.example.com/klip.mp4',
          width: 1080,
          height: 1350,
          duration: 20,
        },
      ],
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

  it('worker: publish gagal (error 190) → audit menyertakan saran hubungkan ulang', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValue({
      id: 'fess_190w',
      content: 'Isi fess',
      postedToIg: false,
    } as any);
    vi.mocked(axios.get).mockResolvedValue({ data: { status_code: 'FINISHED' } } as any);
    vi.mocked(axios.post).mockRejectedValueOnce({
      message: 'Request failed with status code 400',
      response: { data: { error: { code: 190, message: 'Session has expired' } } },
    });

    await InstagramService.finalizeInstagramPost({
      fessId: 'fess_190w',
      baseHandle: '@acc',
      kind: 'reels',
      itemIds: null,
      containerId: 'reel_190',
      attempts: 0,
      exp: Date.now() + 60_000,
    });

    expect(prisma.fess.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fess_190w' },
        data: expect.objectContaining({
          igStatus: 'failed',
          igError: expect.stringContaining('kedaluwarsa'),
        }),
      })
    );
    expect(prisma.systemLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tone: 'error',
          message: expect.stringContaining('kedaluwarsa'),
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
    expect(prisma.fess.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fess_6' },
        data: expect.objectContaining({ igStatus: 'pending' }),
      })
    );
    expect(prisma.systemLog.create).not.toHaveBeenCalled();
  });

  it('kegagalan Meta API → meta_published false + SystemLog berisi detail error', async () => {
    const postSpy = vi.mocked(axios.post);
    postSpy.mockRejectedValueOnce({
      message: 'Request failed with status code 400',
      response: { data: { error: { code: 9004, message: 'The media could not be fetched' } } },
    });

    const result: any = await InstagramService.autoPostFess(
      '@acc',
      'fess_err',
      [{ type: 'image', url: 'https://cdn.example.com/kartu.jpg' }],
      'Error media'
    );

    expect(result.meta_published).toBe(false);
    expect(prisma.systemLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tone: 'error',
          message: expect.stringContaining('The media could not be fetched'),
        }),
      })
    );
  });

  it('token kedaluwarsa (error 190) → SystemLog menyarankan hubungkan ulang', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce({
      message: 'Request failed with status code 400',
      response: { data: { error: { code: 190, message: 'Session has expired' } } },
    });

    const result: any = await InstagramService.autoPostFess(
      '@acc',
      'fess_190',
      [{ type: 'image', url: 'https://cdn.example.com/kartu.jpg' }],
      'Token expired'
    );

    expect(result.meta_published).toBe(false);
    expect(prisma.systemLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tone: 'error',
          message: expect.stringContaining('kedaluwarsa'),
        }),
      })
    );
  });

  it('kuota penuh → publikasi diblokir & tercatat error (tidak panggil Meta)', async () => {
    const postSpy = vi.mocked(axios.post);
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { data: [{ quota_usage: 100, config: { quota_total: 100 } }] },
    } as any);

    const result: any = await InstagramService.autoPostFess(
      '@acc',
      'fess_quota',
      [{ type: 'image', url: 'https://cdn.example.com/kartu.jpg' }],
      'Kuota penuh'
    );

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('Kuota');
    expect(postSpy).not.toHaveBeenCalled();
    expect(prisma.systemLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tone: 'error' }) })
    );
  });

  it('cek kuota gagal → publikasi tetap lanjut (best-effort, tidak memblokir)', async () => {
    vi.mocked(axios.get).mockImplementation(async (url: string) => {
      if (String(url).includes('content_publishing_limit')) {
        throw new Error('quota endpoint down');
      }
      return { data: { status_code: 'FINISHED' } } as any;
    });
    const postSpy = vi.mocked(axios.post);
    postSpy
      .mockResolvedValueOnce({ data: { id: 'konten_1' } } as any)
      .mockResolvedValueOnce({ data: { id: 'media_1' } } as any);

    const result: any = await InstagramService.autoPostFess(
      '@acc',
      'fess_ok',
      [{ type: 'image', url: 'https://cdn.example.com/kartu.jpg' }],
      'Kuota down'
    );

    expect(result.meta_published).toBe(true);
    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  it('gagal unduh gambar sementara → auto-post gambar di-retry otomatis', async () => {
    const { ensureIgImageUrl } = await import('../src/utils/instagram-media.util.js');
    vi.mocked(ensureIgImageUrl).mockRejectedValueOnce(
      Object.assign(new Error('Gagal mengunduh gambar untuk normalisasi Instagram: timeout'), {
        code: 'ETIMEDOUT',
      })
    );

    const result: any = await InstagramService.autoPostFess(
      '@acc',
      'fess_img_retry',
      [
        { type: 'image', url: 'https://cdn.example.com/card.jpg' },
        { type: 'image', url: 'https://cdn.example.com/foto.jpg' },
      ],
      'Retry gambar'
    );

    expect(result.meta_published).toBe(false);
    expect(result.retry_scheduled).toBe(true);
    expect(prisma.fess.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fess_img_retry' },
        data: expect.objectContaining({ igStatus: 'processing' }),
      })
    );

    const retryCall = vi
      .mocked(axios.post)
      .mock.calls.find((call) => String(call[0]).includes('/internal/instagram/retry'));
    expect(retryCall).toBeTruthy();
    expect(InstagramService.verifyRetryPayload((retryCall![1] as any).token)).toMatchObject({
      fessId: 'fess_img_retry',
      attempt: 1,
    });
  });

  it('error sementara 9004 → retry otomatis dijadwalkan (HMAC, percobaan ke-2)', async () => {
    const postSpy = vi.mocked(axios.post);
    postSpy.mockRejectedValueOnce({
      message: 'Request failed with status code 400',
      response: { data: { error: { code: 9004, message: 'The media could not be fetched' } } },
    });

    const result: any = await InstagramService.autoPostFess(
      '@acc',
      'fess_retry',
      [{ type: 'image', url: 'https://cdn.example.com/kartu.jpg' }],
      'Retry media'
    );

    expect(result.meta_published).toBe(false);
    expect(result.retry_scheduled).toBe(true);
    expect(prisma.fess.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fess_retry' },
        data: expect.objectContaining({
          igStatus: 'processing',
          igError: expect.stringContaining('Retry otomatis'),
        }),
      })
    );

    const retryCall = postSpy.mock.calls.find((call) =>
      String(call[0]).includes('/internal/instagram/retry')
    );
    expect(retryCall).toBeTruthy();
    const payload = InstagramService.verifyRetryPayload((retryCall![1] as any).token);
    expect(payload).toMatchObject({
      fessId: 'fess_retry',
      baseHandle: '@acc',
      attempt: 1,
      delayMs: 5000,
    });
  });

  it('video tanpa metadata 4:5 ditolak sebelum container Meta dibuat', async () => {
    const result: any = await InstagramService.autoPostFess(
      '@acc',
      'fess_video_mentah',
      [{ type: 'video', url: 'https://cdn.example.com/mentah.mp4' }],
      'Video mentah'
    );

    expect(result.meta_published).toBe(false);
    expect(String(result.error)).toContain('metadata dimensi');
    expect(vi.mocked(axios.post)).not.toHaveBeenCalled();
    expect(prisma.fess.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fess_video_mentah' },
        data: expect.objectContaining({ igStatus: 'failed' }),
      })
    );
  });

  it('payload retry ditandatangani & tervalidasi (anti tamper)', () => {
    const payload = {
      fessId: 'fess_r',
      baseHandle: '@acc',
      attempt: 1,
      exp: Date.now() + 60_000,
    };

    const token = InstagramService.signRetryPayload(payload);
    expect(InstagramService.verifyRetryPayload(token)).toMatchObject(payload);
    expect(InstagramService.verifyRetryPayload(`${token.slice(0, -3)}abc`)).toBeNull();
    expect(InstagramService.verifyRetryPayload('bukan-token')).toBeNull();

    const expired = InstagramService.signRetryPayload({ ...payload, exp: Date.now() - 1000 });
    expect(InstagramService.verifyRetryPayload(expired)).toBeNull();
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
