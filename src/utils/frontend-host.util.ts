import { ENV } from '../config/env.js';

/**
 * Host frontend aktif untuk watermark (mis. `fessncurious.vercel.app`).
 * `VITE_BACKEND_URL`/`FRONTEND_URL` selalu absolut, jadi URL di-parse dulu.
 */
export function frontendHost(): string {
  const raw = String(ENV.FRONTEND_URL || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).host;
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}