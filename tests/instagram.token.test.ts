import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { InstagramService } from '../src/services/instagram.service.js';
import { prisma } from '../src/config/prisma.js';
import { runInstagramTokenRefresh } from '../src/jobs/instagram-token-refresh.job.js';

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), head: vi.fn() },
}));

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    platformConnection: { findMany: vi.fn(), update: vi.fn() },
    systemLog: { create: vi.fn() },
  },
}));

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Token Instagram 60 hari — exchange, refresh, dan job pemeliharaan', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.platformConnection.update).mockResolvedValue({} as any);
    vi.mocked(prisma.systemLog.create).mockResolvedValue({} as any);
  });

  it('getLongLivedToken mengembalikan token + expiresIn dari Meta', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { access_token: 'long_abc', expires_in: 5183944 },
    } as any);

    const res = await InstagramService.getLongLivedToken('short_abc');
    expect(res).toEqual({ accessToken: 'long_abc', expiresIn: 5183944 });
  });

  it('getLongLivedToken fallback saat Meta gagal → token pendek + expiry 1 jam', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('boom'));

    const res = await InstagramService.getLongLivedToken('short_abc');
    expect(res.accessToken).toBe('short_abc');
    expect(res.expiresIn).toBe(3600);
  });

  it('refreshLongLivedToken memanggil ig_refresh_token & mengembalikan token baru', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { access_token: 'fresh_xyz', expires_in: 5184000 },
    } as any);

    const res = await InstagramService.refreshLongLivedToken('long_lama');
    expect(res).toEqual({ accessToken: 'fresh_xyz', expiresIn: 5184000 });

    const params = (vi.mocked(axios.get).mock.calls[0][1] as any).params;
    expect(params).toMatchObject({ grant_type: 'ig_refresh_token', access_token: 'long_lama' });
  });

  it('refreshLongLivedToken melempar error bila Meta menolak', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('token invalid'));
    await expect(InstagramService.refreshLongLivedToken('long_bad')).rejects.toThrow();
  });

  it('job: token masih segar (> 7 hari) tidak di-refresh', async () => {
    vi.mocked(prisma.platformConnection.findMany).mockResolvedValueOnce([
      {
        id: 'pc_1',
        accessToken: 'tok_real',
        accountHandle: '@a',
        userId: 'u1',
        metadata: { tokenExpiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString() },
      },
    ] as any);

    await runInstagramTokenRefresh();
    expect(axios.get).not.toHaveBeenCalled();
    expect(prisma.platformConnection.update).not.toHaveBeenCalled();
  });

  it('job: token mendekati kedaluwarsa → diperpanjang + dicatat', async () => {
    vi.mocked(prisma.platformConnection.findMany).mockResolvedValueOnce([
      {
        id: 'pc_2',
        accessToken: 'tok_lama',
        accountHandle: '@b',
        userId: 'u2',
        metadata: { tokenExpiresAt: new Date(Date.now() + 3 * DAY_MS).toISOString() },
      },
    ] as any);
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { access_token: 'tok_baru', expires_in: 5184000 },
    } as any);

    await runInstagramTokenRefresh();

    const upd = vi.mocked(prisma.platformConnection.update).mock.calls[0][0] as any;
    expect(upd.where).toEqual({ id: 'pc_2' });
    expect(upd.data.accessToken).toBe('tok_baru');
    expect(upd.data.metadata.tokenExpiresAt).toBeTruthy();
    expect(upd.data.metadata.tokenRefreshedAt).toBeTruthy();
    expect(prisma.systemLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tone: 'ok' }) })
    );
  });

  it('job: refresh gagal → dicatat error, token tidak diganti', async () => {
    vi.mocked(prisma.platformConnection.findMany).mockResolvedValueOnce([
      {
        id: 'pc_3',
        accessToken: 'tok_expired',
        accountHandle: '@c',
        userId: 'u3',
        metadata: { tokenExpiresAt: new Date(Date.now() - DAY_MS).toISOString() },
      },
    ] as any);
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('Session has expired'));

    await runInstagramTokenRefresh();

    expect(prisma.platformConnection.update).not.toHaveBeenCalled();
    expect(prisma.systemLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tone: 'error' }) })
    );
  });

  it('job: token mock & koneksi tanpa catatan expiry dilewati', async () => {
    vi.mocked(prisma.platformConnection.findMany).mockResolvedValueOnce([
      { id: 'pc_mock', accessToken: 'mock_x', accountHandle: '@m', userId: 'u4', metadata: {} },
      { id: 'pc_legacy', accessToken: 'tok_legacy', accountHandle: '@l', userId: 'u5', metadata: {} },
    ] as any);

    await runInstagramTokenRefresh();
    expect(axios.get).not.toHaveBeenCalled();
    expect(prisma.platformConnection.update).not.toHaveBeenCalled();
  });
});
