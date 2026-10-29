import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { authRateLimit, bodyIdentity } from '../src/middlewares/authRateLimit.middleware.js';
import { RateLimitService } from '../src/services/rate-limit.service.js';

vi.mock('../src/services/rate-limit.service.js', () => ({
  RateLimitService: {
    consume: vi.fn(),
  },
}));

function makeRes() {
  const res: any = {
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as Response & { setHeader: any; status: any; json: any };
}

function allowed(remaining = 5) {
  return {
    allowed: true,
    count: 1,
    limit: 10,
    remaining,
    resetAt: new Date(Date.now() + 60_000),
    retryAfterSeconds: 60,
  };
}

function denied() {
  return {
    allowed: false,
    count: 11,
    limit: 10,
    remaining: 0,
    resetAt: new Date(Date.now() + 60_000),
    retryAfterSeconds: 42,
  };
}

describe('authRateLimit middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('meloloskan request selama kuota masih ada', async () => {
    vi.mocked(RateLimitService.consume).mockResolvedValue(allowed());
    const next = vi.fn() as unknown as NextFunction;
    const res = makeRes();

    await authRateLimit({ name: 'login', ipLimit: 10, windowSeconds: 900 })(
      { ip: '1.2.3.4', body: {} } as unknown as Request,
      res,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '5');
  });

  it('membalas 429 beserta Retry-After saat kuota habis', async () => {
    vi.mocked(RateLimitService.consume).mockResolvedValue(denied());
    const next = vi.fn() as unknown as NextFunction;
    const res = makeRes();

    await authRateLimit({
      name: 'login',
      ipLimit: 10,
      windowSeconds: 900,
      code: 'LOGIN_RATE_LIMITED',
    })({ ip: '1.2.3.4', body: {} } as unknown as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '42');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'LOGIN_RATE_LIMITED' })
    );
  });

  it('memakai dua dimensi kunci: IP dan identitas', async () => {
    vi.mocked(RateLimitService.consume).mockResolvedValue(allowed());
    const next = vi.fn() as unknown as NextFunction;

    await authRateLimit({
      name: 'login',
      ipLimit: 20,
      identityLimit: 5,
      windowSeconds: 900,
      identify: bodyIdentity,
    })(
      { ip: '1.2.3.4', body: { identifier: '  Alex@Mail.com ' } } as unknown as Request,
      makeRes(),
      next
    );

    const keys = vi.mocked(RateLimitService.consume).mock.calls.map((c) => c[0]);
    expect(keys).toContain('auth:login:ip:1.2.3.4');
    expect(keys).toContain('auth:login:id:alex@mail.com');
  });

  it('memblokir lebih awal saat kuota identitas habis walau IP masih longgar', async () => {
    vi.mocked(RateLimitService.consume).mockImplementation(async (key: string) =>
      key.includes(':id:') ? denied() : allowed(18)
    );
    const next = vi.fn() as unknown as NextFunction;
    const res = makeRes();

    await authRateLimit({
      name: 'login',
      ipLimit: 20,
      identityLimit: 5,
      windowSeconds: 900,
      identify: bodyIdentity,
    })({ ip: '1.2.3.4', body: { identifier: 'alex@mail.com' } } as unknown as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('fail-open bila penyimpanan kuota error', async () => {
    vi.mocked(RateLimitService.consume).mockRejectedValue(new Error('db down'));
    const next = vi.fn() as unknown as NextFunction;

    await authRateLimit({ name: 'login', ipLimit: 10, windowSeconds: 900 })(
      { ip: '1.2.3.4', body: {} } as unknown as Request,
      makeRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('bodyIdentity mengambil email saat identifier tidak ada', () => {
    expect(bodyIdentity({ body: { email: 'User@Mail.com' } } as unknown as Request)).toBe(
      'user@mail.com'
    );
    expect(bodyIdentity({ body: {} } as unknown as Request)).toBeUndefined();
  });

  it('bodyIdentity memakai hash ticket untuk endpoint verifikasi email', () => {
    const identity = bodyIdentity({ body: { ticket: 'signed-ticket-value' } } as unknown as Request);
    expect(identity).toMatch(/^ticket:[a-f0-9]{32}$/);
    // Ticket yang sama selalu menghasilkan key yang sama, tanpa menyimpan token mentah.
    expect(bodyIdentity({ body: { ticket: 'signed-ticket-value' } } as unknown as Request)).toBe(
      identity
    );
    expect(identity).not.toContain('signed-ticket-value');
  });
});
