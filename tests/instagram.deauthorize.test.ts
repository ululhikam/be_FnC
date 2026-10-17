import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { ENV } from '../src/config/env.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    platformConnection: { findMany: vi.fn(), update: vi.fn() },
    systemLog: { create: vi.fn() },
    user: { updateMany: vi.fn() },
  },
}));

/** Tanda tangani payload persis seperti Meta (signed_request). */
function signRequest(payload: Record<string, unknown>, secret: string): string {
  const toBase64Url = (value: string) =>
    value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const encodedPayload = toBase64Url(Buffer.from(JSON.stringify(payload)).toString('base64'));
  const sig = toBase64Url(
    crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64')
  );
  return `${sig}.${encodedPayload}`;
}

const DEAUTH_URL = `${ENV.API_PREFIX}/auth/instagram/deauthorize`;
const DATA_DELETION_URL = `${ENV.API_PREFIX}/auth/instagram/data-deletion`;

describe('POST /auth/instagram/deauthorize — Deauthorize Callback Meta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.platformConnection.findMany).mockResolvedValue([
      {
        id: 'pc_ig_1',
        userId: 'usr_1',
        platform: 'instagram',
        accountHandle: '@concern_fess',
        accessToken: 'ig_token',
        metadata: { igUserId: '17841400000', igUsername: '@concern_fess' },
      },
      {
        id: 'pc_ig_2',
        userId: 'usr_2',
        platform: 'instagram',
        accountHandle: '@lain',
        accessToken: 'ig_token_2',
        metadata: { igUserId: '99999999' },
      },
    ] as any);
    vi.mocked(prisma.platformConnection.update).mockResolvedValue({} as any);
    vi.mocked(prisma.systemLog.create).mockResolvedValue({} as any);
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 } as any);
  });

  it('signed_request valid → koneksi dicabut, token dihapus, respons berisi URL penghapusan', async () => {
    const signed = signRequest({ user_id: '17841400000', issued_at: 1730000000 }, ENV.INSTAGRAM_CLIENT_SECRET);

    const res = await request(app).post(DEAUTH_URL).send({ signed_request: signed });

    expect(res.status).toBe(200);
    expect(res.body.url).toContain('/data-deletion');
    expect(res.body.confirmation_code).toBeTruthy();

    expect(prisma.platformConnection.update).toHaveBeenCalledTimes(1);
    expect(prisma.platformConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pc_ig_1' },
        data: expect.objectContaining({
          connected: false,
          status: 'revoked',
          accessToken: null,
        }),
      })
    );
    expect(prisma.systemLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tone: 'ok' }) })
    );
  });

  it('signed_request palsu → tetap 200 tapi tidak ada koneksi yang diputus', async () => {
    const res = await request(app)
      .post(DEAUTH_URL)
      .send({ signed_request: 'sig_palsu.payload_palsu' });

    expect(res.status).toBe(200);
    expect(res.body.url).toContain('/data-deletion');
    expect(prisma.platformConnection.update).not.toHaveBeenCalled();
  });

  it('tanpa signed_request → tetap 200 (Meta hanya butuh URL status)', async () => {
    const res = await request(app).post(DEAUTH_URL).send({});

    expect(res.status).toBe(200);
    expect(res.body.url).toContain('/data-deletion');
    expect(prisma.platformConnection.update).not.toHaveBeenCalled();
  });

  it('data-deletion: signed_request valid → koneksi dicabut + binding instagramId dilepas', async () => {
    const signed = signRequest({ user_id: '17841400000' }, ENV.INSTAGRAM_CLIENT_SECRET);

    const res = await request(app).post(DATA_DELETION_URL).send({ signed_request: signed });

    expect(res.status).toBe(200);
    expect(res.body.url).toContain('/data-deletion');
    expect(res.body.confirmation_code).toBeTruthy();

    expect(prisma.platformConnection.update).toHaveBeenCalledTimes(1);
    expect(prisma.platformConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pc_ig_1' },
        data: expect.objectContaining({
          connected: false,
          status: 'revoked',
          accessToken: null,
        }),
      })
    );
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { instagramId: '17841400000' },
      data: { instagramId: null },
    });
  });

  it('data-deletion: signed_request palsu → tetap 200 tanpa menghapus data', async () => {
    const res = await request(app)
      .post(DATA_DELETION_URL)
      .send({ signed_request: 'sig_palsu.payload_palsu' });

    expect(res.status).toBe(200);
    expect(res.body.url).toContain('/data-deletion');
    expect(prisma.platformConnection.update).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
