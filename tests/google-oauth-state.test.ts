import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { ENV } from '../src/config/env.js';
import { signGoogleOAuthState, signOAuthState, verifyGoogleOAuthState } from '../src/utils/oauth-state.util.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const CALLBACK = `${ENV.API_PREFIX}/auth/google/callback`;

/**
 * Callback Google wajib menolak `state` yang tidak bertanda tangan.
 *
 * `passport-oauth2` tidak memverifikasi state ketika tidak ada sesi
 * (`session: false`), sehingga gate ini satu-satunya pengaman terhadap login
 * CSRF: penyerang menyelesaikan OAuth dengan akunnya sendiri lalu mengirim URL
 * callback ke korban.
 */
describe('GET /auth/google/callback — verifikasi state (P-01)', () => {
  const disabled = (res: request.Response) =>
    res.headers.location?.endsWith('/login?error=oauth_state_invalid');

  it('menolak state literal lama "User"', async () => {
    const res = await request(app).get(`${CALLBACK}?code=abc&state=User`);

    expect(res.status).toBe(302);
    expect(disabled(res)).toBe(true);
  });

  it('menolak state literal lama "Base Admin" (tidak bisa naik peran)', async () => {
    const res = await request(app).get(`${CALLBACK}?code=abc&state=Base%20Admin`);

    expect(res.status).toBe(302);
    expect(disabled(res)).toBe(true);
  });

  it('menolak callback tanpa state', async () => {
    const res = await request(app).get(`${CALLBACK}?code=abc`);

    expect(res.status).toBe(302);
    expect(disabled(res)).toBe(true);
  });

  it('menolak state bertanda tangan dengan perubahan tanda tangan', async () => {
    const [body] = signGoogleOAuthState({ role: 'User' }).split('.');
    const res = await request(app).get(`${CALLBACK}?code=abc&state=${body}.palsu`);

    expect(res.status).toBe(302);
    expect(disabled(res)).toBe(true);
  });

  it('menolak state Instagram yang diputar ulang di alur Google', async () => {
    const igState = signOAuthState({ userId: 'usr_1', origin: 'login' });
    const res = await request(app).get(
      `${CALLBACK}?code=abc&state=${encodeURIComponent(igState)}`
    );

    expect(res.status).toBe(302);
    expect(disabled(res)).toBe(true);
  });

  it('meloloskan consent yang ditolak ke failureRedirect passport', async () => {
    const res = await request(app).get(`${CALLBACK}?error=access_denied`);

    // Bukan gate state: pengguna menolak di layar Google, jadi pesannya
    // `google_failed`, bukan `oauth_state_invalid`.
    expect(disabled(res)).toBe(false);
  });
});

describe('GET /auth/google — state yang dikirim ke Google', () => {
  it('membawa peran di dalam amplop bertanda tangan, bukan teks biasa', async () => {
    const res = await request(app).get(`${ENV.API_PREFIX}/auth/google?role=Base%20Admin`);
    expect(res.status).toBe(302);

    const location = String(res.headers.location || '');
    if (!location.startsWith('https://accounts.google.com')) {
      // Kredensial Google tidak terpasang di environment test: rute memilih
      // jalur "belum dikonfigurasi" dan tidak ada state yang dibuat.
      expect(location).toContain('error=google_not_configured');
      return;
    }

    const state = new URL(location).searchParams.get('state') || '';
    expect(state).not.toBe('Base Admin');
    expect(verifyGoogleOAuthState(state)).toMatchObject({
      purpose: 'google_oauth',
      role: 'Base Admin',
    });
  });
});
