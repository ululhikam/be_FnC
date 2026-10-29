import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { RateLimitService, type RateLimitResult } from '../services/rate-limit.service.js';
import { errorResponse } from '../utils/response.util.js';

/**
 * Limiter untuk endpoint autentikasi (login, OTP, registrasi).
 *
 * Limiter global (`middlewares/rateLimit.middleware.ts`) bersifat in-memory per
 * instance: di Vercel setiap invocation bisa punya memori sendiri, jadi
 * serangan brute force paralel praktis tidak terlihat. Di sini bucket disimpan
 * di Postgres (`RateLimitBucket`) sehingga semua instance berbagi hitungan yang
 * sama — syarat agar lockout benar-benar berfungsi.
 *
 * Dua dimensi kunci dipakai sekaligus:
 * - per IP: mencegah satu host menebak banyak akun;
 * - per identitas (email/handle): mencegah banyak IP menebak satu akun.
 */
export type AuthRateLimitOptions = {
  /** Nama bucket; harus unik per endpoint. */
  name: string;
  /** Batas percobaan per IP dalam satu window. */
  ipLimit: number;
  /** Batas percobaan per identitas dalam satu window. */
  identityLimit?: number;
  /** Panjang window dalam detik. */
  windowSeconds: number;
  /** Ambil identitas (email/handle) dari request untuk bucket kedua. */
  identify?: (req: Request) => string | undefined;
  message?: string;
  code?: string;
};

function normalizeIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

export function authRateLimit(options: AuthRateLimitOptions) {
  const code = options.code || 'AUTH_RATE_LIMITED';
  const message =
    options.message ||
    'Terlalu banyak percobaan. Tunggu beberapa menit sebelum mencoba lagi.';

  return async (req: Request, res: Response, next: NextFunction) => {
    const keys: Array<{ key: string; limit: number }> = [];

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    keys.push({ key: `auth:${options.name}:ip:${ip}`, limit: options.ipLimit });

    if (options.identify && options.identityLimit) {
      const identity = normalizeIdentity(options.identify(req));
      if (identity) {
        keys.push({
          key: `auth:${options.name}:id:${identity}`,
          limit: options.identityLimit,
        });
      }
    }

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
      // Fail-open: bila tabel limiter bermasalah, jangan kunci seluruh login.
      // Autentikasi tetap memverifikasi kata sandi/OTP, dan kegagalan ini
      // dicatat agar bisa ditindaklanjuti.
      if (process.env.NODE_ENV !== 'test') {
        console.error('[AuthRateLimit] Gagal memeriksa kuota:', error);
      }
      return next();
    }
  };
}

/** Identitas dari body login/OTP: `identifier` (login), `email`, atau `ticket`. */
export function bodyIdentity(req: Request): string | undefined {
  const body = (req.body || {}) as Record<string, unknown>;
  const direct = normalizeIdentity(body.identifier ?? body.email);
  if (direct) return direct;

  // Endpoint verifikasi email memakai `ticket` (token bertanda tangan), bukan
  // email. Hash dulu supaya key-nya pendek, unik, dan tidak menyimpan token
  // mentah di tabel limiter.
  const ticket = typeof body.ticket === 'string' ? body.ticket.trim() : '';
  if (!ticket) return undefined;
  const digest = crypto.createHash('sha256').update(ticket).digest('hex').slice(0, 32);
  return `ticket:${digest}`;
}
