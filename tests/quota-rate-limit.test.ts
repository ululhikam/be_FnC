import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { RateLimitService, quotaRateLimit } from '../src/services/rate-limit.service.js';
import { denyBannedSession } from '../src/middlewares/auth.middleware.js';

function makeRes() {
  const res: any = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res as Response & { setHeader: any; status: any; json: any };
}

function result(allowed: boolean, remaining = 5) {
  return {
    allowed,
    count: allowed ? 1 : 99,
    limit: 10,
    remaining,
    resetAt: new Date(Date.now() + 60_000),
    retryAfterSeconds: 30,
  };
}

describe('quotaRateLimit (SEC-21, SEC-22)', () => {
  let consumeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consumeSpy = vi.spyOn(RateLimitService, 'consume');
  });

  afterEach(() => {
    consumeSpy.mockRestore();
  });

  it('memakai kunci per user dan per IP sekaligus', async () => {
    consumeSpy.mockResolvedValue(result(true));
    const next = vi.fn() as unknown as NextFunction;

    await quotaRateLimit({ name: 'create-fess', userLimit: 30, ipLimit: 20, windowSeconds: 3600 })(
      { ip: '9.9.9.9', user: { id: 'usr_1' }, socket: {} } as unknown as Request,
      makeRes(),
      next
    );

    expect(consumeSpy.mock.calls.map((call) => call[0])).toEqual([
      'quota:create-fess:user:usr_1',
      'quota:create-fess:ip:9.9.9.9',
    ]);
    expect(next).toHaveBeenCalled();
  });

  it('pengunjung anonim hanya dibatasi per IP', async () => {
    consumeSpy.mockResolvedValue(result(true));
    const next = vi.fn() as unknown as NextFunction;

    await quotaRateLimit({ name: 'create-fess', userLimit: 30, ipLimit: 20, windowSeconds: 3600 })(
      { ip: '9.9.9.9', socket: {} } as unknown as Request,
      makeRes(),
      next
    );

    expect(consumeSpy.mock.calls.map((call) => call[0])).toEqual([
      'quota:create-fess:ip:9.9.9.9',
    ]);
    expect(next).toHaveBeenCalled();
  });

  it('membalas 429 saat kuota habis', async () => {
    consumeSpy.mockResolvedValue(result(false, 0));
    const next = vi.fn() as unknown as NextFunction;
    const res = makeRes();

    await quotaRateLimit({
      name: 'canvas-preview',
      ipLimit: 30,
      windowSeconds: 600,
      code: 'CANVAS_RATE_LIMITED',
    })({ ip: '9.9.9.9', socket: {} } as unknown as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '30');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CANVAS_RATE_LIMITED' })
    );
  });

  it('fail-open bila penyimpanan kuota error', async () => {
    consumeSpy.mockRejectedValue(new Error('db down'));
    const next = vi.fn() as unknown as NextFunction;

    await quotaRateLimit({ name: 'canvas-preview', ipLimit: 30, windowSeconds: 600 })(
      { ip: '9.9.9.9', socket: {} } as unknown as Request,
      makeRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('denyBannedSession (SEC-22)', () => {
  it('menolak sesi yang ditandai dibekukan', () => {
    const next = vi.fn() as unknown as NextFunction;
    const res = makeRes();

    denyBannedSession({ authBlocked: 'BANNED' } as unknown as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCOUNT_BANNED' }));
  });

  it('meloloskan pengunjung anonim dan akun normal', () => {
    const next = vi.fn() as unknown as NextFunction;
    denyBannedSession({} as unknown as Request, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
