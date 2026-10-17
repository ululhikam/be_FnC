import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { parseSignedRequest } from '../src/utils/meta-signed-request.util.js';

/** Bikin signed_request valid persis seperti format Meta. */
function makeSignedRequest(payload: Record<string, unknown>, secret: string): string {
  const toBase64Url = (value: string) =>
    value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const encodedPayload = toBase64Url(Buffer.from(JSON.stringify(payload)).toString('base64'));
  const sig = toBase64Url(
    crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64')
  );
  return `${sig}.${encodedPayload}`;
}

describe('parseSignedRequest — verifikasi callback Meta (deauthorize)', () => {
  const secret = 'test_app_secret_123';

  it('signed_request valid → payload terbaca', () => {
    const signed = makeSignedRequest({ user_id: '17841400000000000', issued_at: 1730000000 }, secret);
    const payload = parseSignedRequest(signed, secret);
    expect(payload).toMatchObject({ user_id: '17841400000000000', issued_at: 1730000000 });
  });

  it('app secret salah → null (tanda tangan tidak cocok)', () => {
    const signed = makeSignedRequest({ user_id: 'x' }, secret);
    expect(parseSignedRequest(signed, 'secret_lain')).toBeNull();
  });

  it('payload diubah (tamper) → null', () => {
    const signed = makeSignedRequest({ user_id: 'asli' }, secret);
    const [, encodedPayload] = signed.split('.');

    const tamperedPayload = Buffer.from(JSON.stringify({ user_id: 'palsu' }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(tamperedPayload).not.toBe(encodedPayload);

    const [sig] = signed.split('.');
    expect(parseSignedRequest(`${sig}.${tamperedPayload}`, secret)).toBeNull();
    // Sanity: yang asli tetap valid.
    expect(parseSignedRequest(signed, secret)).toMatchObject({ user_id: 'asli' });
  });

  it('format tidak valid → null', () => {
    expect(parseSignedRequest('', secret)).toBeNull();
    expect(parseSignedRequest('tanpa-titik', secret)).toBeNull();
    expect(parseSignedRequest('.', secret)).toBeNull();
    expect(parseSignedRequest('sig.', secret)).toBeNull();
    expect(parseSignedRequest('.payload', secret)).toBeNull();
    expect(parseSignedRequest('sig.payload', '')).toBeNull();
  });

  it('payload bukan JSON → null (walau tanda tangan valid)', () => {
    const toBase64Url = (value: string) =>
      value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const encodedPayload = toBase64Url(Buffer.from('bukan-json').toString('base64'));
    const sig = toBase64Url(
      crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64')
    );
    expect(parseSignedRequest(`${sig}.${encodedPayload}`, secret)).toBeNull();
  });
});
