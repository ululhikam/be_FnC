import crypto from 'crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV } from '../src/config/env.js';
import { MidtransError, MidtransService } from '../src/services/midtrans.service.js';

const original = {
  serverKey: ENV.MIDTRANS_SERVER_KEY,
  isProduction: ENV.MIDTRANS_IS_PRODUCTION,
  frontendUrl: ENV.FRONTEND_URL,
};

describe('MidtransService', () => {
  beforeEach(() => {
    ENV.MIDTRANS_SERVER_KEY = 'SB-Mid-server-test';
    ENV.MIDTRANS_IS_PRODUCTION = false;
    ENV.FRONTEND_URL = 'https://fessncurious-dev.vercel.app';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    ENV.MIDTRANS_SERVER_KEY = original.serverKey;
    ENV.MIDTRANS_IS_PRODUCTION = original.isProduction;
    ENV.FRONTEND_URL = original.frontendUrl;
  });

  it('builds a QRIS Core API payload with CTF metadata', () => {
    const payload = MidtransService.buildChargePayload({
      orderId: 'FNC-ORDER-1',
      amountIdr: 5000,
      packageCode: 'coba_dulu',
      packageName: 'Coba Dulu',
      method: 'qris',
      customer: { name: 'tester', email: 'tester@example.com' },
    });

    expect(payload.payment_type).toBe('qris');
    expect(payload.qris).toEqual({ acquirer: 'gopay' });
    expect(payload.transaction_details).toEqual({
      order_id: 'FNC-ORDER-1',
      gross_amount: 5000,
    });
    expect(payload.custom_field1).toBe('ctf_topup');
    expect(payload.custom_field2).toBe('coba_dulu');
  });

  it('maps each supported payment method to the right Core API fields', () => {
    const base = {
      orderId: 'FNC-ORDER-2',
      amountIdr: 10000,
      packageCode: 'hemat',
      packageName: 'Hemat',
      customer: { name: 'tester' },
    } as const;

    expect(MidtransService.buildChargePayload({ ...base, method: 'bca_va' }).bank_transfer).toEqual({
      bank: 'bca',
    });
    expect(MidtransService.buildChargePayload({ ...base, method: 'mandiri_bill' }).echannel).toEqual({
      bill_info1: 'Top-up CTF',
      bill_info2: 'Fess n Curious',
    });
    const gopay = MidtransService.buildChargePayload({ ...base, method: 'gopay' });
    expect(gopay.payment_type).toBe('gopay');
    expect((gopay.gopay as any).enable_callback).toBe(true);
    expect((gopay.gopay as any).callback_url).toContain('FNC-ORDER-2');
    expect(MidtransService.buildChargePayload({ ...base, method: 'shopeepay' }).payment_type).toBe(
      'shopeepay'
    );
  });

  it('verifies the SHA512 notification signature in constant time', () => {
    const serverKey = ENV.MIDTRANS_SERVER_KEY;
    const payload = {
      order_id: 'FNC-ORDER-1',
      status_code: '200',
      gross_amount: '5000.00',
      transaction_status: 'settlement',
    };
    const signature = crypto
      .createHash('sha512')
      .update(`${payload.order_id}${payload.status_code}${payload.gross_amount}${serverKey}`)
      .digest('hex');

    expect(MidtransService.verifySignature({ ...payload, signature_key: signature })).toBe(true);
    expect(
      MidtransService.verifySignature({ ...payload, gross_amount: '1.00', signature_key: signature })
    ).toBe(false);
    expect(MidtransService.verifySignature({ ...payload, signature_key: '' })).toBe(false);
  });

  it('maps a successful charge response into instructions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          transaction_id: 'tx-1',
          transaction_status: 'pending',
          status_code: '201',
          payment_type: 'qris',
          qr_string: 'QR-STRING',
          expiry_time: '2026-10-25T00:00:00.000Z',
          actions: [
            { name: 'generate-qr-code', url: 'https://example.test/qr.png' },
            { name: 'deeplink-redirect', url: 'https://example.test/deeplink' },
          ],
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await MidtransService.charge({
      orderId: 'FNC-ORDER-1',
      amountIdr: 5000,
      packageCode: 'coba_dulu',
      packageName: 'Coba Dulu',
      method: 'qris',
      customer: { name: 'tester', email: 'tester@example.com' },
    });

    expect(result.transactionId).toBe('tx-1');
    expect(result.qrString).toBe('QR-STRING');
    expect(result.qrUrl).toBe('https://example.test/qr.png');
    expect(result.deeplinkUrl).toBe('https://example.test/deeplink');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.sandbox.midtrans.com/v2/charge');
  });

  it('surfaces Midtrans rejection details without leaking the server key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              status_code: '400',
              status_message: 'Invalid payment method',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          )
        )
      )
    );

    try {
      await MidtransService.charge({
        orderId: 'FNC-ORDER-1',
        amountIdr: 5000,
        packageCode: 'coba_dulu',
        packageName: 'Coba Dulu',
        method: 'qris',
        customer: { name: 'tester' },
      });
      throw new Error('expected charge to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(MidtransError);
      expect(error).toMatchObject({ code: 'MIDTRANS_CHARGE_FAILED', status: 502 });
      expect(JSON.stringify(error)).not.toContain('SB-Mid-server-test');
    }
  });

  it('returns null when Midtrans does not know an order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 404 }))
    );
    await expect(MidtransService.getStatus('FNC-UNKNOWN')).resolves.toBeNull();
  });

  it('uses the sandbox API for a sandbox key without the legacy SB- prefix', async () => {
    ENV.MIDTRANS_SERVER_KEY = 'Mid-server-sandbox-key';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', { status: 201, headers: { 'Content-Type': 'application/json' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    await MidtransService.charge({
      orderId: 'FNC-ORDER-1',
      amountIdr: 5000,
      packageCode: 'coba_dulu',
      packageName: 'Coba Dulu',
      method: 'qris',
      customer: { name: 'tester' },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.sandbox.midtrans.com/v2/charge');
  });

  it('uses the production API only when MIDTRANS_IS_PRODUCTION is true', async () => {
    ENV.MIDTRANS_SERVER_KEY = 'Mid-server-production-key';
    ENV.MIDTRANS_IS_PRODUCTION = true;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', { status: 201, headers: { 'Content-Type': 'application/json' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    await MidtransService.charge({
      orderId: 'FNC-ORDER-2',
      amountIdr: 5000,
      packageCode: 'coba_dulu',
      packageName: 'Coba Dulu',
      method: 'qris',
      customer: { name: 'tester' },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.midtrans.com/v2/charge');
  });
});
