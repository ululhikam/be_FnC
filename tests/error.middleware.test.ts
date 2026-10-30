import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    user: { findFirst: vi.fn(), findUnique: vi.fn() },
    fess: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

/**
 * P-05: body-parser melempar SyntaxError tanpa `err.code`. Sebelum perbaikan,
 * JSON rusak dijawab `400` dengan `code: INTERNAL_SERVER_ERROR` dan pesan
 * parser mentah — menyesatkan monitoring sekaligus membocorkan detail internal.
 */
describe('errorHandler — body JSON rusak (P-05)', () => {
  it('membalas 400 BAD_REQUEST dengan pesan generik', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{bad json');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      message: 'Body JSON tidak valid',
      code: 'BAD_REQUEST',
    });
  });

  it('tidak membocorkan pesan parser mentah', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"identifier": }');

    expect(JSON.stringify(res.body)).not.toMatch(/position|Unexpected|Expected property/i);
  });
});

/**
 * P-06: pesan 404 tidak boleh memantulkan path/query yang dikendalikan klien.
 */
describe('notFoundHandler — refleksi path (P-06)', () => {
  it('memakai pesan tetap tanpa path atau query', async () => {
    const res = await request(app).get('/api/non-existent-route-xyz?token=rahasia&email=a@b.c');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Endpoint tidak ditemukan', code: 'NOT_FOUND' });
    expect(JSON.stringify(res.body)).not.toContain('rahasia');
    expect(JSON.stringify(res.body)).not.toContain('non-existent-route-xyz');
  });
});