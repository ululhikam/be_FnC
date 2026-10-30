import crypto from 'crypto';
import { ENV } from '../config/env.js';

/**
 * State OAuth yang ditandatangani (HMAC).
 *
 * Sebelumnya state Instagram hanya base64 JSON tanpa tanda tangan, sehingga
 * callback mempercayai `userId` buatan penyerang dan menerbitkan sesi untuk akun
 * itu — jalur takeover akun mana pun (termasuk Super Admin).
 *
 * State Google punya masalah lain: nilainya hanya literal `'User'` /
 * `'Base Admin'` dan tidak pernah dibandingkan, sehingga parameter `state`
 * kehilangan fungsi anti-CSRF-nya (login CSRF: penyerang memakai akunnya
 * sendiri lalu menyodorkan URL callback ke korban).
 *
 * Keduanya kini memakai amplop bertanda tangan yang sama dengan pembeda
 * `purpose`, sehingga state satu alur tidak bisa dipakai di alur lain.
 *
 * Secret diturunkan dari JWT_SECRET dengan pemisah, sehingga state tidak bisa
 * dipakai sebagai Bearer token dan sebaliknya.
 */
const STATE_SECRET = `${ENV.JWT_SECRET}:oauth-state`;
const DEFAULT_TTL_SECONDS = 10 * 60;

export type OAuthStatePurpose = 'instagram_oauth' | 'google_oauth';

/** Peran yang boleh dibawa state Google. */
export const GOOGLE_OAUTH_ROLES = ['User', 'Base Admin'] as const;
export type GoogleOAuthRole = (typeof GOOGLE_OAUTH_ROLES)[number];

interface BaseOAuthStatePayload {
  purpose: OAuthStatePurpose;
  /** Sekali pakai secara acak — mencegah state ditebak/dipakai ulang. */
  nonce: string;
  /** Epoch detik. */
  exp: number;
}

export interface OAuthStatePayload extends BaseOAuthStatePayload {
  purpose: 'instagram_oauth';
  /** Kosong = alur login/registrasi; terisi = hubungkan akun ke user tsb. */
  userId: string;
  baseHandle: string;
  origin: string;
}

export interface GoogleOAuthStatePayload extends BaseOAuthStatePayload {
  purpose: 'google_oauth';
  role: GoogleOAuthRole;
  /** Halaman tujuan setelah callback; divalidasi di pemanggil. */
  origin: string;
}

type AnyOAuthStatePayload = OAuthStatePayload | GoogleOAuthStatePayload;

function sign(body: string): string {
  return crypto.createHmac('sha256', STATE_SECRET).update(body).digest('base64url');
}

function encode(payload: AnyOAuthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

/**
 * Baca dan verifikasi amplop state. Null bila tanda tangan salah, bentuk tidak
 * sesuai, sudah kedaluwarsa, atau `purpose` tidak cocok dengan yang diminta.
 */
function decode<P extends OAuthStatePurpose>(
  state: string,
  purpose: P
): Extract<AnyOAuthStatePayload, { purpose: P }> | null {
  const [body, signature] = String(state || '').split('.');
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as
      | AnyOAuthStatePayload
      | null;

    // `purpose` membedakan alur: state Google tidak boleh diterima di callback
    // Instagram, dan sebaliknya.
    if (!payload || payload.purpose !== purpose) return null;
    if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) return null;
    if (typeof payload.nonce !== 'string' || !payload.nonce) return null;

    return payload as Extract<AnyOAuthStatePayload, { purpose: P }>;
  } catch {
    return null;
  }
}

function baseTtl(ttlSeconds: number): number {
  return Math.floor(Date.now() / 1000) + ttlSeconds;
}

export function signOAuthState(
  input: { userId?: string; baseHandle?: string; origin?: string },
  ttlSeconds = DEFAULT_TTL_SECONDS
): string {
  return encode({
    purpose: 'instagram_oauth',
    userId: String(input.userId || ''),
    baseHandle: String(input.baseHandle || ''),
    origin: String(input.origin || 'connections'),
    nonce: crypto.randomBytes(16).toString('base64url'),
    exp: baseTtl(ttlSeconds),
  });
}

/** Null bila tanda tangan, bentuk, atau masa berlaku tidak valid. */
export function verifyOAuthState(state: string): OAuthStatePayload | null {
  const payload = decode(state, 'instagram_oauth');
  if (!payload) return null;
  if (typeof payload.userId !== 'string') return null;
  return payload;
}

export function signGoogleOAuthState(
  input: { role?: string; origin?: string },
  ttlSeconds = DEFAULT_TTL_SECONDS
): string {
  const role: GoogleOAuthRole = input.role === 'Base Admin' ? 'Base Admin' : 'User';
  return encode({
    purpose: 'google_oauth',
    role,
    origin: String(input.origin || 'login'),
    nonce: crypto.randomBytes(16).toString('base64url'),
    exp: baseTtl(ttlSeconds),
  });
}

/** Null bila state Google tidak sah, kedaluwarsa, atau bukan untuk alur ini. */
export function verifyGoogleOAuthState(state: string): GoogleOAuthStatePayload | null {
  const payload = decode(state, 'google_oauth');
  if (!payload) return null;
  // Peran di dalam amplop tetap divalidasi: nilai asing tidak boleh menjadi
  // peran akun yang baru didaftarkan.
  if (!GOOGLE_OAUTH_ROLES.includes(payload.role)) return null;
  return payload;
}
