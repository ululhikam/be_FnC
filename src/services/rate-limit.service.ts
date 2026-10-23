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
          'Terlalu banyak percobaan pembayaran. Silakan coba beberapa saat lagi.',
          429,
          'PAYMENT_RATE_LIMITED'
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
