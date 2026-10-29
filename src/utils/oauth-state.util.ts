import crypto from 'crypto';
import { ENV } from '../config/env.js';

/**
 * State OAuth yang ditandatangani (HMAC) untuk alur Instagram.
 *
 * Sebelumnya state hanya base64 JSON tanpa tanda tangan, sehingga callback
 * mempercayai `userId` buatan penyerang dan menerbitkan sesi untuk akun itu —
 * jalur takeover akun mana pun (termasuk Super Admin).
 *
 * Secret diturunkan dari JWT_SECRET dengan pemisah, sehingga state tidak bisa
 * dipakai sebagai Bearer token dan sebaliknya.
 */
const STATE_SECRET = `${ENV.JWT_SECRET}:oauth-state`;
const DEFAULT_TTL_SECONDS = 10 * 60;

export interface OAuthStatePayload {
  purpose: 'instagram_oauth';
  /** Kosong = alur login/registrasi; terisi = hubungkan akun ke user tsb. */
  userId: string;
  baseHandle: string;
  origin: string;
  /** Sekali pakai secara acak — mencegah state ditebak/dipakai ulang. */
  nonce: string;
  /** Epoch detik. */
  exp: number;
}

function sign(body: string): string {
  return crypto.createHmac('sha256', STATE_SECRET).update(body).digest('base64url');
}

export function signOAuthState(
  input: { userId?: string; baseHandle?: string; origin?: string },
  ttlSeconds = DEFAULT_TTL_SECONDS
): string {
  const payload: OAuthStatePayload = {
    purpose: 'instagram_oauth',
    userId: String(input.userId || ''),
    baseHandle: String(input.baseHandle || ''),
    origin: String(input.origin || 'connections'),
    nonce: crypto.randomBytes(16).toString('base64url'),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

/** Null bila tanda tangan, bentuk, atau masa berlaku tidak valid. */
export function verifyOAuthState(state: string): OAuthStatePayload | null {
  const [body, signature] = String(state || '').split('.');
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    ) as OAuthStatePayload;

    if (payload?.purpose !== 'instagram_oauth') return null;
    if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) return null;
    if (typeof payload.userId !== 'string' || typeof payload.nonce !== 'string') return null;
    if (!payload.nonce) return null;

    return payload;
  } catch {
    return null;
  }
}
