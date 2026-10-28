import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { ENV } from '../config/env.js';
import type { PaymentMethodCode } from '../constants/payments.js';
import { PaymentService } from '../services/payment.service.js';
import { errorResponse } from '../utils/response.util.js';

function secretsMatch(expected: string, provided: string) {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
      if (!secretsMatch(ENV.PAYMENT_RECONCILE_SECRET, req.get('x-reconcile-secret') || '')) {
        return errorResponse(res, 'Secret rekonsiliasi tidak valid', 401, 'FORBIDDEN');
      }

      const requestedLimit = Number(req.body?.limit ?? 25);
      const limit = Number.isFinite(requestedLimit) ? requestedLimit : 25;
      const result = await PaymentService.reconcilePending(limit);
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  }
}
