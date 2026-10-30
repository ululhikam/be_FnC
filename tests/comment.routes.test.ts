import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { ENV } from '../src/config/env.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    fess: { findUnique: vi.fn() },
    comment: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(),
  },
}));

describe('Endpoint edit/hapus komentar', () => {
  it('PATCH komentar tanpa token ditolak 401', async () => {
    const res = await request(app)
      .patch(`${ENV.API_PREFIX}/fesses/fess_1/comments/c_1`)
      .send({ text: 'diubah' });

    expect(res.status).toBe(401);
  });

  it('DELETE komentar tanpa token ditolak 401', async () => {
    const res = await request(app).delete(`${ENV.API_PREFIX}/fesses/fess_1/comments/c_1`);

    expect(res.status).toBe(401);
  });
});