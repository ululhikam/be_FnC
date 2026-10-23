import { Request, Response, NextFunction } from 'express';
import { errorResponse } from '../utils/response.util.js';

interface RateLimitStore {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitStore>();

// Default rate limit configuration (can be updated via Super Admin)
export const rateLimitConfig = {
  maxPerMinute: 60,
  windowMs: 60 * 1000,
};

// Midtrans is server-to-server and can legitimately burst above the global
// per-IP budget. This route has its own Postgres-backed limiter and SHA512
// signature verification.
const WEBHOOK_PATHS = new Set([
  '/api/payments/midtrans/notification',
  '/payments/midtrans/notification',
]);

export function rateLimiter(req: Request, res: Response, next: NextFunction) {
  if (WEBHOOK_PATHS.has(req.path)) return next();
  const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
  const now = Date.now();

  const record = store.get(ip);
  if (!record || now > record.resetAt) {
    store.set(ip, {
      count: 1,
      resetAt: now + rateLimitConfig.windowMs,
    });
    return next();
  }

  record.count += 1;
  if (record.count > rateLimitConfig.maxPerMinute) {
    return errorResponse(
      res,
      'Terlalu banyak permintaan. Silakan coba beberapa saat lagi.',
      429,
      'RATE_LIMIT_EXCEEDED'
    );
  }

  next();
}
