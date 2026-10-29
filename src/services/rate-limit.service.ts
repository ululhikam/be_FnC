import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { errorResponse } from '../utils/response.util.js';

export type RateLimitResult = {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
};

/**
 * Fixed-window limiter backed by Postgres. Unlike the in-memory global
 * limiter, this is shared by every serverless instance.
 */
export class RateLimitService {
  static async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    if (!key || key.length > 240) {
      throw new Error('Rate limit key tidak valid');
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Rate limit tidak valid');
    }
    if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
      throw new Error('Rate limit window tidak valid');
    }

    const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "updatedAt")
      VALUES (${key}, 1, NOW() + (${windowSeconds} * INTERVAL '1 second'), NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitBucket"."resetAt" <= NOW() THEN 1
          ELSE "RateLimitBucket"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "RateLimitBucket"."resetAt" <= NOW()
            THEN NOW() + (${windowSeconds} * INTERVAL '1 second')
          ELSE "RateLimitBucket"."resetAt"
        END,
        "updatedAt" = NOW()
      RETURNING "count", "resetAt"
    `;

    const row = rows[0];
    const count = Number(row?.count ?? 1);
    const resetAt = row?.resetAt ? new Date(row.resetAt) : new Date(Date.now() + windowSeconds * 1000);
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));

    return {
      allowed: count <= limit,
      count,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt,
      retryAfterSeconds,
    };
  }
}

type PaymentRateLimitOptions = {
  name: string;
  limit: number;
  windowSeconds: number;
  includeIp?: boolean;
  message?: string;
  code?: string;
};

/**
 * Express middleware for payment routes. It checks both the authenticated
 * user and the source IP so one account or one host cannot bypass the other.
 */
export function paymentRateLimit(options: PaymentRateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const keys: string[] = [];
      if (req.user?.id) keys.push(`pay:${options.name}:user:${req.user.id}`);
      if (options.includeIp !== false) {
        keys.push(`pay:${options.name}:ip:${req.ip || req.socket.remoteAddress || 'unknown'}`);
      }

      let tightest: RateLimitResult | null = null;
      for (const key of keys) {
        const result = await RateLimitService.consume(key, options.limit, options.windowSeconds);
        if (!result.allowed) {
          tightest = result;
          break;
        }
        if (!tightest || result.remaining < tightest.remaining) tightest = result;
      }

      if (tightest && !tightest.allowed) {
        res.setHeader('Retry-After', String(tightest.retryAfterSeconds));
        return errorResponse(
          res,
          options.message || 'Terlalu banyak percobaan pembayaran. Silakan coba beberapa saat lagi.',
          429,
          options.code || 'PAYMENT_RATE_LIMITED'
        );
      }

      if (tightest) {
        res.setHeader('X-RateLimit-Limit', String(tightest.limit));
        res.setHeader('X-RateLimit-Remaining', String(tightest.remaining));
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(tightest.resetAt.getTime() / 1000)));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Limiter generik berbasis Postgres untuk endpoint mahal (render canvas,
 * posting) atau rawan penyalahgunaan.
 *
 * Kunci per user (bila login) **dan** per IP dipakai bersamaan: kuota per user
 * mencegah satu akun menyalahgunakan, kuota per IP mencegah satu host membuat
 * banyak akun/anonim. Fail-open bila tabel limiter bermasalah, dengan catatan
 * di log — lebih baik endpoint tetap jalan daripada seluruh layanan mati.
 */
export type QuotaRateLimitOptions = {
  /** Nama bucket; harus unik per endpoint. */
  name: string;
  /** Batas per user terautentikasi dalam satu window. */
  userLimit?: number;
  /** Batas per IP dalam satu window. */
  ipLimit?: number;
  windowSeconds: number;
  message?: string;
  code?: string;
};

export function quotaRateLimit(options: QuotaRateLimitOptions) {
  const code = options.code || 'RATE_LIMITED';
  const message =
    options.message || 'Terlalu banyak permintaan. Tunggu beberapa saat sebelum mencoba lagi.';

  return async (req: Request, res: Response, next: NextFunction) => {
    const keys: Array<{ key: string; limit: number }> = [];

    if (options.userLimit && req.user?.id) {
      keys.push({ key: `quota:${options.name}:user:${req.user.id}`, limit: options.userLimit });
    }
    if (options.ipLimit) {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      keys.push({ key: `quota:${options.name}:ip:${ip}`, limit: options.ipLimit });
    }

    if (!keys.length) return next();

    try {
      let tightest: RateLimitResult | null = null;
      for (const { key, limit } of keys) {
        const result = await RateLimitService.consume(key, limit, options.windowSeconds);
        if (!result.allowed) {
          tightest = result;
          break;
        }
        if (!tightest || result.remaining < tightest.remaining) tightest = result;
      }

      if (tightest && !tightest.allowed) {
        res.setHeader('Retry-After', String(tightest.retryAfterSeconds));
        return errorResponse(res, message, 429, code);
      }

      if (tightest) {
        res.setHeader('X-RateLimit-Limit', String(tightest.limit));
        res.setHeader('X-RateLimit-Remaining', String(tightest.remaining));
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(tightest.resetAt.getTime() / 1000)));
      }

      return next();
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error(`[QuotaRateLimit:${options.name}] Gagal memeriksa kuota:`, error);
      }
      return next();
    }
  };
}
