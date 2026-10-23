import crypto from 'crypto';
import { ENV } from '../config/env.js';
import type { PaymentMethodCode } from '../constants/payments.js';

export type MidtransChargeInput = {
  orderId: string;
  amountIdr: number;
  packageCode: string;
  packageName: string;
  method: PaymentMethodCode;
  customer: {
    name: string;
    email?: string | null;
  };
};

export type MidtransChargeResult = {
  transactionId?: string;
  transactionStatus?: string;
  statusCode?: string;
  statusMessage?: string;
  paymentType?: string;
  qrString?: string;
  qrUrl?: string;
  vaNumber?: string;
  deeplinkUrl?: string;
  billerCode?: string;
  billKey?: string;
  actions?: unknown;
  expiresAt?: Date;
  raw: Record<string, unknown>;
};

export class MidtransError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(code: string, message: string, status = 502, details?: unknown) {
    super(message);
    this.name = 'MidtransError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type MidtransAction = {
  name?: string;
  url?: string;
  method?: string;
};

const REQUEST_TIMEOUT_MS = 15_000;

function assertConfigured() {
  if (!ENV.MIDTRANS_SERVER_KEY) {
    throw new MidtransError(
      'PAYMENT_CONFIG_ERROR',
      'Midtrans server key belum dikonfigurasi',
      503
    );
  }
  if (ENV.MIDTRANS_IS_PRODUCTION && ENV.MIDTRANS_SERVER_KEY.startsWith('SB-')) {
    throw new MidtransError(
      'PAYMENT_CONFIG_ERROR',
      'Server key Midtrans sandbox tidak boleh dipakai di production',
      503
    );
  }
  if (!ENV.MIDTRANS_IS_PRODUCTION && ENV.MIDTRANS_SERVER_KEY.startsWith('Mid-server-')) {
    throw new MidtransError(
      'PAYMENT_CONFIG_ERROR',
      'Server key Midtrans production tidak boleh dipakai di sandbox',
      503
    );
  }
}

function basicAuthHeader() {
  return `Basic ${Buffer.from(`${ENV.MIDTRANS_SERVER_KEY}:`).toString('base64')}`;
}

function baseUrl() {
  return ENV.MIDTRANS_IS_PRODUCTION
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2';
}

function callbackUrl(orderId: string) {
  const base = ENV.FRONTEND_URL.replace(/\/$/, '');
  return `${base}/wallet?payment=finish&order_id=${encodeURIComponent(orderId)}`;
}

function asActions(value: unknown): MidtransAction[] {
  return Array.isArray(value) ? (value as MidtransAction[]) : [];
}

export class MidtransService {
  static isConfigured() {
    return Boolean(ENV.MIDTRANS_SERVER_KEY);
  }

  static buildChargePayload(input: MidtransChargeInput): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      transaction_details: {
        order_id: input.orderId,
        gross_amount: input.amountIdr,
      },
      item_details: [
        {
          id: input.packageCode,
          price: input.amountIdr,
          quantity: 1,
          name: input.packageName.slice(0, 50),
        },
      ],
      customer_details: {
        first_name: input.customer.name.slice(0, 50),
        ...(input.customer.email ? { email: input.customer.email } : {}),
      },
      custom_field1: 'ctf_topup',
      custom_field2: input.packageCode,
    };

    switch (input.method) {
      case 'qris':
        payload.payment_type = 'qris';
        payload.qris = { acquirer: 'gopay' };
        break;
      case 'bca_va':
        payload.payment_type = 'bank_transfer';
        payload.bank_transfer = { bank: 'bca' };
        break;
      case 'bni_va':
        payload.payment_type = 'bank_transfer';
        payload.bank_transfer = { bank: 'bni' };
        break;
      case 'bri_va':
        payload.payment_type = 'bank_transfer';
        payload.bank_transfer = { bank: 'bri' };
        break;
      case 'permata_va':
        payload.payment_type = 'bank_transfer';
        payload.bank_transfer = { bank: 'permata' };
        break;
      case 'mandiri_bill':
        payload.payment_type = 'echannel';
        payload.echannel = {
          bill_info1: 'Top-up CTF',
          bill_info2: 'Fess n Curious',
        };
        break;
      case 'gopay':
        payload.payment_type = 'gopay';
        payload.gopay = {
          enable_callback: true,
          callback_url: callbackUrl(input.orderId),
        };
        break;
      case 'shopeepay':
        payload.payment_type = 'shopeepay';
        payload.shopeepay = { callback_url: callbackUrl(input.orderId) };
        break;
      default:
        throw new MidtransError('INVALID_PAYMENT_METHOD', 'Metode pembayaran tidak didukung', 400);
    }

    return payload;
  }

  static async charge(input: MidtransChargeInput): Promise<MidtransChargeResult> {
    assertConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${baseUrl()}/charge`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: basicAuthHeader(),
        },
        body: JSON.stringify(this.buildChargePayload(input)),
        signal: controller.signal,
      });
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      throw new MidtransError(
        isAbort ? 'MIDTRANS_TIMEOUT' : 'MIDTRANS_NETWORK_ERROR',
        isAbort
          ? 'Midtrans tidak merespons tepat waktu'
          : 'Tidak dapat terhubung ke Midtrans',
        502
      );
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let raw: Record<string, unknown> = {};
    try {
      raw = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      raw = { raw_text: text.slice(0, 2000) };
    }

    if (!response.ok) {
      const message =
        typeof raw.status_message === 'string'
          ? raw.status_message
          : 'Midtrans menolak permintaan pembayaran';
      throw new MidtransError(
        'MIDTRANS_CHARGE_FAILED',
        message,
        502,
        { httpStatus: response.status, status_code: raw.status_code, status_message: raw.status_message }
      );
    }

    return this.mapChargeResponse(raw);
  }

  static async getStatus(orderId: string): Promise<Record<string, unknown> | null> {
    assertConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${baseUrl()}/${encodeURIComponent(orderId)}/status`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: basicAuthHeader(),
        },
        signal: controller.signal,
      });
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      throw new MidtransError(
        isAbort ? 'MIDTRANS_TIMEOUT' : 'MIDTRANS_NETWORK_ERROR',
        isAbort
          ? 'Midtrans tidak merespons tepat waktu'
          : 'Tidak dapat terhubung ke Midtrans',
        502
      );
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let raw: Record<string, unknown> = {};
    try {
      raw = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      raw = { raw_text: text.slice(0, 2000) };
    }

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new MidtransError(
        'MIDTRANS_STATUS_FAILED',
        typeof raw.status_message === 'string'
          ? raw.status_message
          : 'Gagal mengambil status pembayaran dari Midtrans',
        502,
        { httpStatus: response.status, status_code: raw.status_code }
      );
    }

    return raw;
  }

  /**
   * Midtrans signature: SHA512(order_id + status_code + gross_amount + server_key).
   * Compare in constant time so an attacker cannot learn the expected digest.
   */
  static verifySignature(payload: Record<string, unknown>): boolean {
    assertConfigured();
    const orderId = String(payload.order_id ?? '');
    const statusCode = String(payload.status_code ?? '');
    const grossAmount = String(payload.gross_amount ?? '');
    const signature = String(payload.signature_key ?? '');
    if (!orderId || !statusCode || !grossAmount || !signature) return false;

    const expected = crypto
      .createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${ENV.MIDTRANS_SERVER_KEY}`)
      .digest('hex');

    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(signature, 'utf8');
    if (expectedBuffer.length !== actualBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  }

  private static mapChargeResponse(raw: Record<string, unknown>): MidtransChargeResult {
    const actions = asActions(raw.actions);
    const qrAction = actions.find((action) => action.name === 'generate-qr-code');
    const deeplinkAction = actions.find(
      (action) => action.name === 'deeplink-redirect' || action.name === 'go-pay-deeplink'
    );
    const vaNumbers = Array.isArray(raw.va_numbers)
      ? (raw.va_numbers as Array<{ va_number?: string }>)
      : [];
    const rawExpiry = typeof raw.expiry_time === 'string' ? new Date(raw.expiry_time) : null;
    const expiresAt =
      rawExpiry && !Number.isNaN(rawExpiry.getTime())
        ? rawExpiry
        : new Date(Date.now() + 24 * 60 * 60 * 1000);

    return {
      transactionId: typeof raw.transaction_id === 'string' ? raw.transaction_id : undefined,
      transactionStatus:
        typeof raw.transaction_status === 'string' ? raw.transaction_status : undefined,
      statusCode: typeof raw.status_code === 'string' ? raw.status_code : undefined,
      statusMessage: typeof raw.status_message === 'string' ? raw.status_message : undefined,
      paymentType: typeof raw.payment_type === 'string' ? raw.payment_type : undefined,
      qrString: typeof raw.qr_string === 'string' ? raw.qr_string : undefined,
      qrUrl: qrAction?.url,
      vaNumber:
        (typeof raw.permata_va_number === 'string' ? raw.permata_va_number : undefined) ||
        vaNumbers[0]?.va_number ||
        undefined,
      deeplinkUrl:
        deeplinkAction?.url ||
        (typeof raw.redirect_url === 'string' ? raw.redirect_url : undefined),
      billerCode: typeof raw.biller_code === 'string' ? raw.biller_code : undefined,
      billKey: typeof raw.bill_key === 'string' ? raw.bill_key : undefined,
      actions: raw.actions,
      expiresAt,
      raw,
    };
  }
}
