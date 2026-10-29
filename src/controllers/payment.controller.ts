import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ENV } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import type { PaymentMethodCode } from '../constants/payments.js';
import { PaymentService } from '../services/payment.service.js';
import { errorResponse } from '../utils/response.util.js';

function secretsMatch(expected: string, provided: string) {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Jendela toleransi jam antara pemanggil (cron) dan server. */
const RECONCILE_MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Tanda tangan HMAC-SHA256 atas timestamp permintaan.
 *
 * Secret statis di header mengautentikasi pemanggil, tetapi tidak mengikat
 * waktu: siapa pun yang pernah melihat satu permintaan sah (log proxy,
 * riwayat shell) bisa memutar ulangnya kapan saja. Dengan HMAC + timestamp,
 * permintaan di luar jendela 5 menit ditolak.
 *
 * Yang ditandatangani hanya timestamp, bukan body: body sudah di-parse
 * `express.json` sehingga serialisasi ulang di server belum tentu identik
 * dengan byte yang dikirim klien, dan body endpoint ini hanya `{ limit }`
 * yang juga dibatasi di dalam service.
 *
 * Secret yang dipakai tetap `PAYMENT_RECONCILE_SECRET` agar operasional tidak
 * perlu menyimpan kredensial tambahan.
 */
function verifyReconcileSignature(secret: string, req: Request): boolean {
  const timestamp = String(req.get('x-reconcile-timestamp') || '').trim();
  const signature = String(req.get('x-reconcile-signature') || '').trim();
  if (!/^\d{9,12}$/.test(timestamp) || !signature) return false;

  const sentAt = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > RECONCILE_MAX_SKEW_MS) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(timestamp)
    .digest('hex');

  return secretsMatch(expected, signature.toLowerCase());
}

export class PaymentController {
  static async getPackages(_req: Request, res: Response, next: NextFunction) {
    try {
      return res.status(200).json(await PaymentService.getPackages());
    } catch (error) {
      next(error);
    }
  }

  static async createOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const requestKey = req.get('Idempotency-Key');
      if (!requestKey) {
        return errorResponse(
          res,
          'Header Idempotency-Key wajib dikirim agar top-up tidak dobel.',
          400,
          'IDEMPOTENCY_KEY_REQUIRED'
        );
      }

      const result = await PaymentService.createOrder(req.user!, {
        packageCode: String(req.body.package_code),
        method: String(req.body.payment_method) as PaymentMethodCode,
        requestKey,
        couponCode: req.body.coupon_code ? String(req.body.coupon_code) : null,
      });
      return res.status(result.idempotent ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async listOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = Number(req.query.limit ?? 20);
      const offset = Number(req.query.offset ?? 0);
      const result = await PaymentService.listOrders(req.user!, limit, offset);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const sync = req.query.sync !== 'false';
      const order = await PaymentService.getOrder(req.user!, String(req.params.orderId), sync);
      return res.status(200).json(order);
    } catch (error) {
      next(error);
    }
  }

  static async notification(req: Request, res: Response, next: NextFunction) {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 32_000) {
        return errorResponse(
          res,
          'Payload notifikasi terlalu besar',
          413,
          'PAYLOAD_TOO_LARGE'
        );
      }
      const result = await PaymentService.handleNotification(
        body,
        {
          ipAddress: req.ip || req.socket.remoteAddress || null,
          userAgent: req.get('user-agent') || null,
        }
      );
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  static async reconcile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!ENV.PAYMENT_RECONCILE_SECRET) {
        return errorResponse(
          res,
          'Rekonsiliasi pembayaran belum dikonfigurasi',
          503,
          'RECONCILE_DISABLED'
        );
      }

      // Kill switch: saat pembayaran dimatikan, rekonsiliasi tidak boleh
      // menyentuh order sama sekali — termasuk mengubah status menjadi PAID.
      if (!ENV.PAYMENTS_ENABLED) {
        return errorResponse(
          res,
          'Rekonsiliasi pembayaran tidak aktif karena pembayaran sedang dimatikan',
          503,
          'PAYMENTS_DISABLED'
        );
      }

      // Dua cara autentikasi: HMAC+timestamp (disarankan, tahan replay) atau
      // secret statis lama (kompatibilitas cron yang belum diperbarui).
      const signed = verifyReconcileSignature(ENV.PAYMENT_RECONCILE_SECRET, req);
      const legacy = secretsMatch(ENV.PAYMENT_RECONCILE_SECRET, req.get('x-reconcile-secret') || '');
      if (!signed && !legacy) {
        return errorResponse(res, 'Secret rekonsiliasi tidak valid', 401, 'FORBIDDEN');
      }

      const requestedLimit = Number(req.body?.limit ?? 25);
      const limit = Number.isFinite(requestedLimit) ? requestedLimit : 25;
      const result = await PaymentService.reconcilePending(limit);

      // Jejak siapa menjalankan rekonsiliasi dan berapa order yang tersentuh.
      await prisma.adminAuditLog
        .create({
          data: {
            action: 'PAYMENT_RECONCILE',
            targetType: 'PaymentOrder',
            reason: 'Rekonsiliasi status pembayaran manual',
            metadata: {
              limit,
              checked: result.checked ?? null,
              processed: result.processed ?? null,
              failed: result.failed ?? null,
              auth: signed ? 'hmac' : 'secret',
            } as Prisma.InputJsonValue,
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.get('user-agent') || null,
          },
        })
        .catch(() => undefined);

      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  }
}
