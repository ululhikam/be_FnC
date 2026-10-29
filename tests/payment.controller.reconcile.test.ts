import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ENV } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import { PaymentController } from '../src/controllers/payment.controller.js';
import { PaymentService } from '../src/services/payment.service.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

const SECRET = 'reconcile-secret-yang-panjang-untuk-uji';

function makeRes() {
  const res: any = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res as Response & { status: any; json: any };
}

function makeReq(headers: Record<string, string> = {}, body: any = {}) {
  return {
    ip: '10.0.0.9',
    socket: {},
    body,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function hmac(timestamp: string) {
  return crypto.createHmac('sha256', SECRET).update(timestamp).digest('hex');
}

describe('PaymentController.reconcile (SEC-27)', () => {
  const originalEnabled = ENV.PAYMENTS_ENABLED;
  const originalSecret = ENV.PAYMENT_RECONCILE_SECRET;
  let reconcileSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    ENV.PAYMENTS_ENABLED = true;
    ENV.PAYMENT_RECONCILE_SECRET = SECRET;
    vi.mocked(prisma.adminAuditLog.create).mockResolvedValue({} as any);
    reconcileSpy = vi.spyOn(PaymentService, 'reconcilePending').mockResolvedValue({
      checked: 2,
      processed: 1,
      failed: 1,
    } as any);
  });

  afterEach(() => {
    ENV.PAYMENTS_ENABLED = originalEnabled;
    ENV.PAYMENT_RECONCILE_SECRET = originalSecret;
    // Hanya spy ini yang dipulihkan: `restoreAllMocks()` juga me-reset mock
    // modul prisma sehingga `adminAuditLog.create` menjadi undefined.
    reconcileSpy.mockRestore();
  });

  it('menolak permintaan saat pembayaran dimatikan', async () => {
    ENV.PAYMENTS_ENABLED = false;
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    const timestamp = String(Math.floor(Date.now() / 1000));
    await PaymentController.reconcile(
      makeReq({
        'x-reconcile-timestamp': timestamp,
        'x-reconcile-signature': hmac(timestamp),
      }),
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PAYMENTS_DISABLED' })
    );
    expect(PaymentService.reconcilePending).not.toHaveBeenCalled();
  });

  it('menerima tanda tangan HMAC yang masih dalam jendela waktu', async () => {
    const res = makeRes();
    const timestamp = String(Math.floor(Date.now() / 1000));

    await PaymentController.reconcile(
      makeReq(
        { 'x-reconcile-timestamp': timestamp, 'x-reconcile-signature': hmac(timestamp) },
        { limit: 5 }
      ),
      res,
      vi.fn() as unknown as NextFunction
    );

    expect(PaymentService.reconcilePending).toHaveBeenCalledWith(5);
    expect(res.status).toHaveBeenCalledWith(200);
    // Rekonsiliasi meninggalkan jejak siapa yang menjalankannya.
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PAYMENT_RECONCILE',
          metadata: expect.objectContaining({ auth: 'hmac', limit: 5 }),
        }),
      })
    );
  });

  it('menolak tanda tangan HMAC dengan timestamp kedaluwarsa', async () => {
    const res = makeRes();
    const timestamp = String(Math.floor(Date.now() / 1000) - 10 * 60);

    await PaymentController.reconcile(
      makeReq({ 'x-reconcile-timestamp': timestamp, 'x-reconcile-signature': hmac(timestamp) }),
      res,
      vi.fn() as unknown as NextFunction
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(PaymentService.reconcilePending).not.toHaveBeenCalled();
  });

  it('menolak tanda tangan yang tidak cocok', async () => {
    const res = makeRes();
    const timestamp = String(Math.floor(Date.now() / 1000));

    await PaymentController.reconcile(
      makeReq({ 'x-reconcile-timestamp': timestamp, 'x-reconcile-signature': 'deadbeef' }),
      res,
      vi.fn() as unknown as NextFunction
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(PaymentService.reconcilePending).not.toHaveBeenCalled();
  });

  it('masih menerima header secret lama untuk cron yang belum diperbarui', async () => {
    const res = makeRes();

    await PaymentController.reconcile(
      makeReq({ 'x-reconcile-secret': SECRET }),
      res,
      vi.fn() as unknown as NextFunction
    );

    expect(PaymentService.reconcilePending).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('menolak secret lama yang salah', async () => {
    const res = makeRes();

    await PaymentController.reconcile(
      makeReq({ 'x-reconcile-secret': 'salah' }),
      res,
      vi.fn() as unknown as NextFunction
    );

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('menolak saat secret rekonsiliasi belum dikonfigurasi', async () => {
    ENV.PAYMENT_RECONCILE_SECRET = '';
    const res = makeRes();

    await PaymentController.reconcile(
      makeReq({ 'x-reconcile-secret': 'apa-saja' }),
      res,
      vi.fn() as unknown as NextFunction
    );

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RECONCILE_DISABLED' })
    );
  });
});
