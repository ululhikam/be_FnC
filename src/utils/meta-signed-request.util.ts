import crypto from 'crypto';

/**
 * Verifikasi & parsing `signed_request` Meta — dipakai untuk callback resmi
 * (Deauthorize / Data Deletion) dari dashboard Meta for Developers.
 *
 * Format: `<base64url(HMAC-SHA256(payload, app_secret))>.<base64url(payload)>`
 * Payload berisi JSON, mis. `{ user_id, issued_at }`.
 *
 * Mengembalikan objek payload bila tanda tangan valid, atau `null` bila
 * format salah / tanda tangan tidak cocok (anti-tamper).
 */
export function parseSignedRequest(
  signedRequest: string,
  appSecret: string
): Record<string, unknown> | null {
  if (!signedRequest || !appSecret) return null;

  const dot = signedRequest.indexOf('.');
  if (dot <= 0 || dot === signedRequest.length - 1) return null;

  const encodedSig = signedRequest.slice(0, dot);
  const encodedPayload = signedRequest.slice(dot + 1);

  const toBase64Url = (value: string) =>
    value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const expectedSig = toBase64Url(
    crypto.createHmac('sha256', appSecret).update(encodedPayload).digest('base64')
  );

  const provided = Buffer.from(encodedSig);
  const expected = Buffer.from(expectedSig);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const json = Buffer.from(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8'
    );
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
