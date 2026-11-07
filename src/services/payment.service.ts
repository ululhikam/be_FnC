import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import type { PaymentEvent, PaymentOrder } from '@prisma/client';
import { PaymentEventStatus, PaymentOrderStatus } from '@prisma/client';
import { ENV } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import {
  BASE_REVENUE_PER_FESS_IDR,
  CTF_PER_PAID_FESS,
  PAYMENT_EXPIRY_MINUTES,
  findPaymentMethod,
  methodAllowsAmount,
  normalizeCouponCode,
  type PaymentMethod,
  type PaymentMethodCode,
} from '../constants/payments.js';
import { parseMidtransDate } from '../utils/midtrans-date.util.js';
import { CouponService } from './coupon.service.js';
import { CtfWalletService } from './ctf-wallet.service.js';
import { MidtransError, MidtransService } from './midtrans.service.js';
import { PaymentGatewayService } from './payment-gateway.service.js';
import { PaymentMethodService } from './payment-method.service.js';
import { PaymentPackageService } from './payment-package.service.js';

export type PaymentUser = {
  id: string;
  username: string;
  email?: string | null;
  emailVerifiedAt?: Date | null;
  role?: string;
};

export type CreatePaymentOrderInput = {
  packageCode: string;
  method: PaymentMethodCode;
  requestKey: string;
  couponCode?: string | null;
};

export type PaymentApplyOptions = {
  source: 'notification' | 'sync';
  eventId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type PaymentApplyResult = {
  status: string;
  ignored?: boolean;
  credited?: boolean;
  already?: boolean;
  balance?: number;
};

type PaymentNotificationMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

function paymentError(code: string, message: string, status = 400) {
  const error: any = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

/** Format rupiah untuk pesan error yang dibaca user. */
function rupiahIdr(value: number) {
  return `Rp${Math.max(0, Math.round(value)).toLocaleString('id-ID')}`;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function assertRequestKey(requestKey: string) {
  if (!/^[A-Za-z0-9._:-]{8,180}$/.test(requestKey)) {
    throw paymentError(
      'INVALID_REQUEST_KEY',
      'Idempotency-Key wajib 8-180 karakter (huruf, angka, titik, garis bawah, titik dua, atau strip)',
      400
    );
  }
}

function amountMatches(rawAmount: unknown, expectedAmount: number) {
  const value =
    typeof rawAmount === 'string'
      ? Number(rawAmount)
      : typeof rawAmount === 'number'
        ? rawAmount
        : Number.NaN;
  if (!Number.isFinite(value)) return false;
  return Math.round(value * 100) === Math.round(expectedAmount * 100);
}

/**
 * Pesan untuk user ketika Midtrans menolak charge. Pesan asli Midtrans
 * ("Payment channel is not activated.") berbahasa Inggris dan tidak bisa
 * ditindaklanjuti user, jadi disimpan di `rawResponse` untuk admin dan diganti
 * arahan yang jelas di sini.
 */
function chargeRejectionMessage(method: PaymentMethod): string {
  return (
    `${method.label} belum bisa dipakai untuk top-up saat ini karena kanal pembayarannya ` +
    'belum aktif di Midtrans. Tidak ada tagihan yang dibuat dan saldo CTF-mu tidak terpotong. ' +
    'Pilih metode pembayaran lain, atau coba lagi nanti.'
  );
}

/**
 * Tolak metode yang nominalnya di bawah batas minimum (VA bank Rp10.000).
 * Pesan menyebut nominal yang dibutuhkan supaya user tahu harus pilih paket
 * berapa, bukan sekadar "gagal".
 *
 * `amountLabel` menjelaskan nominal yang dicek ("Paket Hemat (Rp10.000)" atau
 * "Total setelah kupon (Rp8.000)") agar pesan tidak menyesatkan saat kupon
 * menurunkan tagihan.
 */
function assertMethodAmount(method: PaymentMethod, amountIdr: number, amountLabel: string) {
  if (methodAllowsAmount(method, amountIdr)) return;
  throw paymentError(
    'PAYMENT_METHOD_MIN_AMOUNT',
    `${method.label} minimal transaksi ${rupiahIdr(method.minAmountIdr as number)}. ` +
      `${amountLabel} belum mencapai batas itu — pilih paket yang lebih besar, ` +
      'atau bayar dengan QRIS/e-wallet.',
    422
  );
}

function paymentChannelFor(method: PaymentMethodCode): string {
  switch (method) {
    case 'bca_va':
      return 'bca';
    case 'bni_va':
      return 'bni';
    case 'bri_va':
      return 'bri';
    case 'cimb_va':
      return 'cimb';
    case 'permata_va':
      return 'permata';
    case 'mandiri_bill':
      return 'mandiri';
    case 'gopay':
      return 'gopay';
    case 'shopeepay':
      return 'shopeepay';
    default:
      return 'qris';
  }
}

function actionsFrom(value: unknown): Array<{ name?: string; url?: string }> {
  return Array.isArray(value) ? (value as Array<{ name?: string; url?: string }>) : [];
}

/**
 * `signature_key` tidak disimpan: nilainya tidak bisa dipakai tanpa server key,
 * tetapi menyimpannya berarti siapa pun yang membaca tabel `PaymentEvent`
 * (backup, ekspor admin, log) memegang payload bertanda tangan valid.
 */
function withoutSignature(payload: Record<string, unknown>): Record<string, unknown> {
  const { signature_key: _signatureKey, ...rest } = payload;
  return rest;
}

function eventKey(payload: Record<string, unknown>) {
  return crypto
    .createHash('sha256')
    .update(
      [
        String(payload.order_id ?? ''),
        String(payload.transaction_id ?? ''),
        String(payload.transaction_status ?? ''),
        String(payload.status_code ?? ''),
        String(payload.fraud_status ?? ''),
        String(payload.gross_amount ?? ''),
        String(payload.signature_key ?? ''),
      ].join('|')
    )
    .digest('hex');
}

export class PaymentService {
  static async getPackages() {
    // Metode yang dinonaktifkan Super Admin tidak ditawarkan. Order lama tidak
    // terpengaruh: pembacaannya memakai katalog penuh (`findPaymentMethod`).
    const [methods, gateway] = await Promise.all([
      PaymentMethodService.getEnabledMethods(),
      PaymentGatewayService.getConfig(),
    ]);

    return {
      enabled: ENV.PAYMENTS_ENABLED,
      configured: MidtransService.isConfigured(),
      currency: 'IDR',
      ctf_per_paid_fess: CTF_PER_PAID_FESS,
      base_revenue_per_paid_fess_idr: BASE_REVENUE_PER_FESS_IDR,
      packages: await PaymentPackageService.listActive(),
      // Urutan sudah mengikuti pilihan Super Admin. `min_amount_idr` dikirim
      // supaya UI bisa menonaktifkan metode yang tidak memenuhi batas nominal
      // sebelum user menekan tombol bayar (server tetap memvalidasi ulang).
      methods: methods.map((method) => ({
        code: method.code,
        label: method.label,
        group: method.group,
        description: method.description,
        min_amount_idr: method.minAmountIdr ?? null,
      })),
      // Mode gateway bersifat platform-wide. Frontend memakai `snap_popup_ready`
      // untuk memutuskan popup atau redirect tanpa pernah melihat Server Key.
      gateway,
    };
  }

  static async createOrder(user: PaymentUser, input: CreatePaymentOrderInput) {
    if (!ENV.PAYMENTS_ENABLED) {
      throw paymentError(
        'PAYMENTS_DISABLED',
        'Top-up CTF sedang dinonaktifkan sementara',
        503
      );
    }
    if (!MidtransService.isConfigured()) {
      throw paymentError(
        'PAYMENT_CONFIG_ERROR',
        'Pembayaran belum dikonfigurasi oleh admin',
        503
      );
    }

    assertRequestKey(input.requestKey);
    const pkg = await PaymentPackageService.findForOrder(input.packageCode);
    if (!pkg) throw paymentError('UNKNOWN_PACKAGE', 'Paket top-up tidak ditemukan', 400);
    const method = findPaymentMethod(input.method);
    if (!method) throw paymentError('UNKNOWN_PAYMENT_METHOD', 'Metode pembayaran tidak dikenal', 400);

    // Ditolak di server, bukan hanya disembunyikan di UI: klien lama atau
    // request manual tetap tidak bisa memakai metode yang dinonaktifkan.
    // Dibaca fresh supaya perubahan toggle langsung berlaku.
    if (!(await PaymentMethodService.isEnabled(method.code, { fresh: true }))) {
      throw paymentError(
        'PAYMENT_METHOD_DISABLED',
        `Metode ${method.label} sedang tidak tersedia. Pilih metode pembayaran lain.`,
        409
      );
    }

    const normalizedCoupon = input.couponCode ? normalizeCouponCode(input.couponCode) : '';
    if (input.couponCode && !normalizedCoupon) {
      throw paymentError('INVALID_COUPON_CODE', 'Format kode kupon tidak valid', 422);
    }

    const existing = await prisma.paymentOrder.findUnique({
      where: { requestKey: input.requestKey },
    });
    if (existing) {
      this.assertSameRequest(
        existing,
        user.id,
        pkg.code,
        method.code,
        normalizedCoupon || null
      );
      return { order: this.serializeOrder(existing), idempotent: true };
    }

    // Batas minimum per metode (VA bank Rp10.000). Ditegakkan di server karena
    // Midtrans menolak tagihan VA di bawah batas tersebut; UI hanya
    // menonaktifkan tombolnya supaya user tidak menabrak error di akhir.
    // Diletakkan setelah pemeriksaan idempotensi agar replay request yang sama
    // tetap mengembalikan order lama, bukan error baru.
    assertMethodAmount(method, pkg.amountIdr, `Paket ${pkg.name} (${rupiahIdr(pkg.amountIdr)})`);

    // Dibaca fresh (tanpa cache) supaya perubahan toggle Super Admin langsung
    // berlaku untuk order berikutnya. Nilai ini disimpan sebagai snapshot.
    const gatewayMode = await PaymentGatewayService.getMode({ fresh: true });

    const orderId = `FNC-${Date.now().toString(36).toUpperCase()}-${crypto
      .randomBytes(5)
      .toString('hex')
      .toUpperCase()}`;
    const now = new Date();
    const initialExpiry = new Date(now.getTime() + PAYMENT_EXPIRY_MINUTES * 60 * 1000);

    let order: PaymentOrder;
    try {
      // Order dan reservasi kupon dibuat dalam satu transaksi: kalau kupon
      // ditolak (kuota habis / sudah dipakai), tidak ada order yang tertinggal.
      order = await prisma.$transaction(async (tx) => {
        let discountIdr = 0;
        let couponCode: string | null = null;
        if (normalizedCoupon) {
          const reservation = await CouponService.reserve(tx, {
            code: normalizedCoupon,
            userId: user.id,
            orderId,
            amountIdr: pkg.amountIdr,
          });
          discountIdr = reservation.discountIdr;
          couponCode = reservation.code;
        }

        // Kupon bisa menurunkan tagihan di bawah batas minimum metode. Kalau
        // tidak dicek di sini, order VA tercatat PENDING padahal Midtrans akan
        // menolaknya. Transaksi di-rollback sehingga kuota kupon tidak terpakai.
        const payable = pkg.amountIdr - discountIdr;
        assertMethodAmount(method, payable, `Total setelah kupon (${rupiahIdr(payable)})`);

        return tx.paymentOrder.create({
          data: {
            orderId,
            requestKey: input.requestKey,
            userId: user.id,
            packageCode: pkg.code,
            packageName: pkg.name,
            amountIdr: pkg.amountIdr - discountIdr,
            ctfAmount: pkg.ctfAmount,
            couponCode,
            discountIdr,
            currency: 'IDR',
            status: PaymentOrderStatus.PENDING,
            paymentMethod: method.code,
            paymentChannel: paymentChannelFor(method.code),
            gatewayMode,
            expiresAt: initialExpiry,
          },
        });
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const raced = await prisma.paymentOrder.findUnique({
          where: { requestKey: input.requestKey },
        });
        if (raced) {
          this.assertSameRequest(
            raced,
            user.id,
            pkg.code,
            method.code,
            normalizedCoupon || null
          );
          return { order: this.serializeOrder(raced), idempotent: true };
        }
      }
      throw error;
    }

    const chargeInput = {
      orderId: order.orderId,
      amountIdr: order.amountIdr,
      packageCode: order.packageCode,
      packageName: order.packageName,
      method: method.code,
      customer: { name: user.username, email: user.email },
    };

    let result: Awaited<ReturnType<typeof MidtransService.charge>> | null = null;
    let snapResult: Awaited<ReturnType<typeof MidtransService.createSnapTransaction>> | null = null;
    try {
      if (gatewayMode === 'snap') {
        snapResult = await MidtransService.createSnapTransaction(chargeInput);
      } else {
        result = await MidtransService.charge(chargeInput);
      }
    } catch (error) {
      const midtransError = error instanceof MidtransError ? error : null;
      const details = midtransError?.details as
        | {
            httpStatus?: number;
            status_code?: unknown;
            status_message?: unknown;
            error_messages?: unknown;
          }
        | undefined;
      const httpStatus = Number(details?.httpStatus);
      const bodyStatus = Number(details?.status_code);
      const errorMessages = Array.isArray(details?.error_messages)
        ? details.error_messages.map((message) => String(message)).filter(Boolean)
        : [];
      const midtransMessage = String(
        details?.status_message ?? errorMessages[0] ?? midtransError?.message ?? ''
      );
      // Midtrans bisa membalas HTTP 200 dengan `status_code` 4xx di body
      // (channel belum aktif). Itu penolakan pasti, bukan status tak pasti,
      // jadi order harus FAILED agar user tidak menunggu pembayaran hantu.
      const explicitRejection =
        (httpStatus >= 400 && httpStatus < 500) ||
        (bodyStatus >= 400 && bodyStatus < 500) ||
        // Snap hanya punya dua hasil: token dibuat, atau tidak. Kegagalan
        // membuat token berarti tidak ada tagihan yang bisa dibayar, jadi
        // jangan biarkan order menggantung PENDING tanpa token.
        (gatewayMode === 'snap' && midtransError?.code === 'MIDTRANS_SNAP_FAILED');
      const channelInactive =
        bodyStatus === 402 ||
        httpStatus === 402 ||
        /payment channel is not activated|merchant pop id is not found/i.test(midtransMessage);
      await prisma.paymentOrder
        .update({
          where: { id: order.id },
          data: {
            status: explicitRejection ? PaymentOrderStatus.FAILED : PaymentOrderStatus.PENDING,
            failedAt: explicitRejection ? new Date() : undefined,
            midtransStatus: explicitRejection
              ? channelInactive
                ? 'channel_unavailable'
                : 'charge_rejected'
              : 'charge_uncertain',
            rawResponse: {
              charge_error: {
                code: midtransError?.code || 'MIDTRANS_ERROR',
                message: midtransError?.message || 'Gagal membuat transaksi Midtrans',
                gateway_mode: gatewayMode,
                httpStatus: httpStatus || null,
                error_messages: errorMessages,
              },
            } as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);

      // Pesan Midtrans bersifat teknis dan berbahasa Inggris, jadi tidak pernah
      // diteruskan apa adanya ke user. Pesan aslinya tetap tersimpan pada
      // `rawResponse.charge_error` agar bisa ditelusuri admin.
      if (channelInactive) {
        throw paymentError('PAYMENT_METHOD_UNAVAILABLE', chargeRejectionMessage(method), 409);
      }
      if (explicitRejection) {
        throw paymentError(
          'PAYMENT_REJECTED',
          'Pembayaran ditolak oleh penyedia pembayaran. Tidak ada tagihan yang dibuat; ' +
            'coba lagi atau pilih metode pembayaran lain.',
          409
        );
      }
      throw paymentError(
        'PAYMENT_GATEWAY_UNAVAILABLE',
        'Layanan pembayaran sedang tidak dapat dihubungi. Tidak ada tagihan yang dibuat; ' +
          'coba lagi beberapa saat lagi.',
        503
      );
    }

    // Snap: simpan token + redirect URL. Status pembayaran tetap ditentukan
    // webhook / Status API, bukan callback popup di browser.
    if (snapResult) {
      const updated = await prisma.paymentOrder.update({
        where: { id: order.id },
        data: {
          midtransStatus: 'pending',
          snapToken: snapResult.token,
          snapRedirectUrl: snapResult.redirectUrl,
          rawResponse: snapResult.raw as Prisma.InputJsonValue,
          expiresAt: initialExpiry,
          lastSyncedAt: new Date(),
        },
      });
      return { order: this.serializeOrder(updated), idempotent: false };
    }

    if (!result) {
      throw paymentError(
        'PAYMENT_GATEWAY_UNAVAILABLE',
        'Layanan pembayaran sedang tidak dapat dihubungi. Tidak ada tagihan yang dibuat; ' +
          'coba lagi beberapa saat lagi.',
        503
      );
    }

    const actions = actionsFrom(result.actions);
    const qrAction = actions.find((action) => action.name === 'generate-qr-code');
    const deeplinkAction = actions.find(
      (action) => action.name === 'deeplink-redirect' || action.name === 'go-pay-deeplink'
    );

    // Batas waktu ke user tidak pernah melebihi 10 menit. Kalau kanal memberi
    // masa berlaku lebih pendek dan masih valid, nilai itu yang dipakai. Order
    // yang telat dibayar tetap dikreditkan lewat `settleOrder` (menerima
    // status EXPIRED) karena uangnya benar-benar masuk.
    const gatewayExpiry = result.expiresAt;
    const finalExpiry =
      gatewayExpiry &&
      gatewayExpiry.getTime() > Date.now() &&
      gatewayExpiry.getTime() < initialExpiry.getTime()
        ? gatewayExpiry
        : initialExpiry;

    const updated = await prisma.paymentOrder.update({
      where: { id: order.id },
      data: {
        midtransTransactionId: result.transactionId,
        midtransStatus: result.transactionStatus,
        qrString: result.qrString,
        qrUrl: result.qrUrl || qrAction?.url,
        vaNumber: result.vaNumber,
        deeplinkUrl: result.deeplinkUrl || deeplinkAction?.url,
        billerCode: result.billerCode,
        billKey: result.billKey,
        actions: result.actions ? (result.actions as Prisma.InputJsonValue) : undefined,
        expiresAt: finalExpiry,
        rawResponse: result.raw as Prisma.InputJsonValue,
        lastSyncedAt: new Date(),
      },
    });

    // Some e-wallet charges can settle immediately. Let the shared status
    // pipeline credit the wallet instead of duplicating that logic here.
    if (result.transactionStatus === 'settlement' || result.transactionStatus === 'capture') {
      await this.syncOrder(updated).catch(() => undefined);
      const refreshed = await prisma.paymentOrder.findUnique({ where: { id: order.id } });
      if (refreshed) return { order: this.serializeOrder(refreshed), idempotent: false };
    }

    return { order: this.serializeOrder(updated), idempotent: false };
  }

  static async listOrders(user: PaymentUser, limit = 20, offset = 0) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const safeOffset = Math.max(offset, 0);
    const [orders, total] = await Promise.all([
      prisma.paymentOrder.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: safeLimit,
        skip: safeOffset,
      }),
      prisma.paymentOrder.count({ where: { userId: user.id } }),
    ]);

    return {
      data: orders.map((order) => this.serializeOrder(order)),
      total,
      limit: safeLimit,
      offset: safeOffset,
    };
  }

  static async getOrder(user: PaymentUser, orderId: string, sync = true) {
    let order = await prisma.paymentOrder.findUnique({ where: { orderId } });
    if (!order) throw paymentError('PAYMENT_ORDER_NOT_FOUND', 'Order pembayaran tidak ditemukan', 404);
    if (order.userId !== user.id && user.role !== 'Super Admin') {
      throw paymentError('FORBIDDEN', 'Kamu tidak dapat melihat order pembayaran ini', 403);
    }

    if (sync && order.status === PaymentOrderStatus.PENDING) {
      const lastSync = order.lastSyncedAt?.getTime() ?? 0;
      if (Date.now() - lastSync >= 30_000) {
        await this.syncOrder(order).catch(() => undefined);
        order = (await prisma.paymentOrder.findUnique({ where: { orderId } })) || order;
      }
    }

    return this.serializeOrder(order);
  }

  static async handleNotification(payload: Record<string, unknown>, meta: PaymentNotificationMeta = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw paymentError('INVALID_NOTIFICATION', 'Payload notifikasi tidak valid', 400);
    }

    const orderId = String(payload.order_id ?? '');
    const transactionStatus = String(payload.transaction_status ?? '');
    const statusCode = String(payload.status_code ?? '');
    if (!orderId || !transactionStatus || !statusCode) {
      throw paymentError('INVALID_NOTIFICATION', 'Notifikasi Midtrans tidak lengkap', 400);
    }

    // Reject invalid signatures before touching the database. Random probes
    // against this public webhook must not be able to grow PaymentEvent storage.
    const signatureValid = MidtransService.verifySignature(payload);
    if (!signatureValid) {
      throw paymentError('INVALID_SIGNATURE', 'Signature notifikasi tidak valid', 401);
    }

    const order = await prisma.paymentOrder.findUnique({ where: { orderId } });
    if (!order) {
      return { ignored: true, status: 'unknown_order' };
    }

    const key = eventKey(payload);

    let event: PaymentEvent | null = null;
    try {
      event = await prisma.paymentEvent.create({
        data: {
          orderId,
          eventType: 'midtrans.notification',
          status: PaymentEventStatus.RECEIVED,
          signatureValid: true,
          idempotencyKey: key,
          payload: withoutSignature(payload) as Prisma.InputJsonValue,
          ipAddress: meta.ipAddress || null,
          userAgent: meta.userAgent || null,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        event = await prisma.paymentEvent.findUnique({ where: { idempotencyKey: key } });
        if (!event) throw error;
        if (event.status === PaymentEventStatus.INVALID_SIGNATURE) {
          throw paymentError('INVALID_SIGNATURE', 'Signature notifikasi tidak valid', 401);
        }
        if (
          event.status === PaymentEventStatus.PROCESSED ||
          event.status === PaymentEventStatus.IGNORED
        ) {
          return { duplicate: true, status: 'already_processed' };
        }
        // FAILED/RECEIVED events may be retried by Midtrans. Fall through and
        // reprocess; the payment status transition and CTF ledger are idempotent.
      } else {
        throw error;
      }
    }

    if (event) {
      await prisma.paymentEvent
        .update({ where: { id: event.id }, data: { paymentOrderId: order.id } })
        .catch(() => undefined);
    }

    const currency = payload.currency ? String(payload.currency).toUpperCase() : 'IDR';
    if (!amountMatches(payload.gross_amount, order.amountIdr) || currency !== 'IDR') {
      const message = `Nominal/currency notifikasi tidak cocok untuk ${order.orderId}`;
      if (event) {
        await prisma.paymentEvent
          .update({
            where: { id: event.id },
            data: {
              status: PaymentEventStatus.FAILED,
              errorMessage: message,
              processedAt: new Date(),
            },
          })
          .catch(() => undefined);
      }
      await prisma.adminAuditLog
        .create({
          data: {
            action: 'PAYMENT_AMOUNT_MISMATCH',
            targetType: 'PaymentOrder',
            targetId: order.id,
            reason: message,
            metadata: {
              order_id: order.orderId,
              expected_amount_idr: order.amountIdr,
              received_gross_amount: payload.gross_amount ?? null,
              received_currency: payload.currency ?? null,
              transaction_status: transactionStatus,
            } as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
      throw paymentError('PAYMENT_AMOUNT_MISMATCH', message, 400);
    }

    try {
      const result = await this.applyStatus(order, payload, {
        source: 'notification',
        eventId: event?.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      if (event) {
        await prisma.paymentEvent.update({
          where: { id: event.id },
          data: {
            status: result.ignored ? PaymentEventStatus.IGNORED : PaymentEventStatus.PROCESSED,
            processedAt: new Date(),
          },
        });
      }
      return result;
    } catch (error) {
      if (event) {
        await prisma.paymentEvent
          .update({
            where: { id: event.id },
            data: {
              status: PaymentEventStatus.FAILED,
              errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
              processedAt: new Date(),
            },
          })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  static async syncOrder(order: PaymentOrder) {
    if (order.status !== PaymentOrderStatus.PENDING) return null;

    const statusPayload = await MidtransService.getStatus(order.orderId);
    if (!statusPayload) {
      if (order.expiresAt && order.expiresAt.getTime() < Date.now()) {
        await prisma.paymentOrder.updateMany({
          where: { id: order.id, status: PaymentOrderStatus.PENDING },
          data: { status: PaymentOrderStatus.EXPIRED, midtransStatus: 'not_found' },
        });
      }
      return null;
    }

    const payload: Record<string, unknown> = {
      ...statusPayload,
      order_id: order.orderId,
      gross_amount: statusPayload.gross_amount ?? order.amountIdr.toFixed(2),
      currency: statusPayload.currency ?? 'IDR',
    };

    const currency = String(payload.currency ?? 'IDR').toUpperCase();
    if (!amountMatches(payload.gross_amount, order.amountIdr) || currency !== 'IDR') {
      await prisma.adminAuditLog
        .create({
          data: {
            action: 'PAYMENT_SYNC_AMOUNT_MISMATCH',
            targetType: 'PaymentOrder',
            targetId: order.id,
            reason: 'Nominal/currency status Midtrans tidak cocok',
            metadata: {
              order_id: order.orderId,
              expected_amount_idr: order.amountIdr,
              received_gross_amount: payload.gross_amount,
              received_currency: payload.currency,
            } as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
      throw paymentError('PAYMENT_AMOUNT_MISMATCH', 'Nominal pembayaran tidak cocok', 400);
    }

    return this.applyStatus(order, payload, { source: 'sync' });
  }

  static async reconcilePending(limit = 25) {
    const orders = await prisma.paymentOrder.findMany({
      where: {
        status: PaymentOrderStatus.PENDING,
        createdAt: { lt: new Date(Date.now() - 2 * 60 * 1000) },
        OR: [
          { lastSyncedAt: null },
          { lastSyncedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    let processed = 0;
    let failed = 0;
    for (const order of orders) {
      try {
        await this.syncOrder(order);
        processed += 1;
      } catch {
        failed += 1;
      }
    }
    return { checked: orders.length, processed, failed };
  }

  private static assertSameRequest(
    order: PaymentOrder,
    userId: string,
    packageCode: string,
    method: string,
    couponCode: string | null = null
  ) {
    if (
      order.userId !== userId ||
      order.packageCode !== packageCode ||
      order.paymentMethod !== method ||
      (order.couponCode ?? null) !== couponCode
    ) {
      throw paymentError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency-Key sudah dipakai untuk permintaan pembayaran yang berbeda',
        409
      );
    }
  }

  /**
   * Tentukan status transaksi yang dipakai untuk memutuskan kredit CTF.
   *
   * Untuk notifikasi webhook yang mengklaim `settlement`/`capture+accept`, klaim
   * itu tidak dipercaya begitu saja: signature Midtrans tidak mencakup
   * `transaction_status`, sehingga payload lama yang sah dapat diputar ulang
   * sebagai settlement. Status sebenarnya diambil dari Status API
   * (`GET /v2/{order_id}/status`). Bila status tidak bisa dipastikan, permintaan
   * digagalkan (Midtrans akan mencoba ulang) — lebih baik tertunda daripada
   * mengkredit CTF tanpa uang masuk.
   */
  private static async resolveTransactionStatus(
    order: PaymentOrder,
    payload: Record<string, unknown>,
    options: PaymentApplyOptions
  ): Promise<{ transactionStatus: string; fraudStatus: string }> {
    const claimedStatus = String(payload.transaction_status ?? '').toLowerCase();
    const claimedFraud = String(payload.fraud_status ?? '').toLowerCase();

    const claimsSettlement =
      claimedStatus === 'settlement' || (claimedStatus === 'capture' && claimedFraud === 'accept');

    // Polling status (`sync`) sudah mengambil data langsung dari gateway.
    if (!claimsSettlement || options.source !== 'notification') {
      return { transactionStatus: claimedStatus, fraudStatus: claimedFraud };
    }

    const verified = await MidtransService.getStatus(order.orderId);
    if (!verified) {
      throw paymentError(
        'PAYMENT_STATUS_UNVERIFIED',
        'Status pembayaran tidak dapat diverifikasi ke Midtrans',
        502
      );
    }

    const statusCode = String(verified.status_code ?? '');
    if (statusCode !== '200') {
      throw paymentError(
        'PAYMENT_STATUS_UNVERIFIED',
        'Midtrans menolak permintaan status pembayaran',
        502
      );
    }

    const verifiedStatus = String(verified.transaction_status ?? '').toLowerCase();
    const verifiedFraud = String(verified.fraud_status ?? '').toLowerCase();

    if (verifiedStatus !== claimedStatus) {
      await prisma.adminAuditLog
        .create({
          data: {
            action: 'PAYMENT_STATUS_MISMATCH',
            targetType: 'PaymentOrder',
            targetId: order.id,
            reason: 'Status notifikasi berbeda dengan status resmi Midtrans',
            metadata: {
              order_id: order.orderId,
              claimed_status: claimedStatus,
              verified_status: verifiedStatus,
              verified_fraud_status: verifiedFraud,
            } as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
    }

    return { transactionStatus: verifiedStatus, fraudStatus: verifiedFraud };
  }

  private static async applyStatus(
    order: PaymentOrder,
    payload: Record<string, unknown>,
    options: PaymentApplyOptions
  ): Promise<PaymentApplyResult> {
    // Signature Midtrans hanya mengikat order_id + status_code + gross_amount;
    // `transaction_status` & `fraud_status` TIDAK ikut ditandatangani. Payload
    // sah untuk order yang masih pending bisa diputar ulang dengan
    // `transaction_status: "settlement"` dan mengkredit CTF tanpa uang masuk.
    // Karena itu klaim settlement selalu diverifikasi ulang ke Status API dan
    // keputusan memakai status dari gateway.
    const { transactionStatus, fraudStatus } = await this.resolveTransactionStatus(
      order,
      payload,
      options
    );
    const data = this.paymentDataFromPayload(payload);

    if (
      transactionStatus === 'settlement' ||
      (transactionStatus === 'capture' && fraudStatus === 'accept')
    ) {
      return this.settleOrder(order, payload, data);
    }

    if (transactionStatus === 'pending' || transactionStatus === 'authorize') {
      await prisma.paymentOrder.updateMany({
        where: { id: order.id, status: PaymentOrderStatus.PENDING },
        data: { ...data, midtransStatus: transactionStatus },
      });
      return { status: 'pending' };
    }

    if (transactionStatus === 'capture' && fraudStatus === 'challenge') {
      await prisma.paymentOrder.updateMany({
        where: { id: order.id, status: PaymentOrderStatus.PENDING },
        data: { ...data, midtransStatus: 'challenge' },
      });
      return { status: 'challenge' };
    }

    if (transactionStatus === 'capture' && fraudStatus === 'deny') {
      await this.failOrder(order, data, 'deny');
      return { status: 'failed' };
    }

    if (transactionStatus === 'deny' || transactionStatus === 'cancel' || transactionStatus === 'failure') {
      await this.failOrder(order, data, transactionStatus);
      return { status: 'failed' };
    }

    if (transactionStatus === 'expire') {
      await prisma.paymentOrder.updateMany({
        where: { id: order.id, status: PaymentOrderStatus.PENDING },
        data: { ...data, status: PaymentOrderStatus.EXPIRED, midtransStatus: transactionStatus },
      });
      return { status: 'expired' };
    }

    if (transactionStatus === 'refund' || transactionStatus === 'partial_refund') {
      const nextStatus =
        transactionStatus === 'partial_refund'
          ? PaymentOrderStatus.PARTIAL_REFUND
          : PaymentOrderStatus.REFUNDED;
      const update = await prisma.paymentOrder.updateMany({
        where: {
          id: order.id,
          status: { in: [PaymentOrderStatus.PAID, PaymentOrderStatus.PARTIAL_REFUND] },
        },
        data: {
          ...data,
          status: nextStatus,
          refundedAt: new Date(),
          refundedAmountIdr: Number(payload.refund_amount ?? payload.gross_amount ?? 0) || undefined,
          refundReason: String(payload.refund_reason ?? 'Midtrans refund'),
        },
      });
      // Midtrans may deliver the same refund notification more than once, and
      // order polling can re-apply it. Only audit when this call actually moved
      // the order into a refund state.
      if (update.count === 0) {
        return { status: nextStatus.toLowerCase(), ignored: true };
      }
      await this.auditPaymentEvent(
        order,
        'PAYMENT_REFUND_RECEIVED',
        'Refund/partial refund diterima dari Midtrans. CTF tidak didebit otomatis; review manual.',
        payload,
        options
      );
      return { status: nextStatus.toLowerCase() };
    }

    if (transactionStatus === 'chargeback') {
      const update = await prisma.paymentOrder.updateMany({
        where: {
          id: order.id,
          status: PaymentOrderStatus.PAID,
        },
        data: { ...data, status: PaymentOrderStatus.CHARGEBACK },
      });
      if (update.count === 0) {
        return { status: 'chargeback', ignored: true };
      }
      await this.auditPaymentEvent(
        order,
        'PAYMENT_CHARGEBACK_RECEIVED',
        'Chargeback diterima. CTF tidak didebit otomatis; review manual.',
        payload,
        options
      );
      return { status: 'chargeback' };
    }

    return { status: order.status.toLowerCase(), ignored: true };
  }

  /**
   * Order gagal (deny/cancel/failure). Kupon hanya dilepas bila status benar
   * benar berubah jadi FAILED, supaya notifikasi duplikat tidak mengembalikan
   * kuota dua kali.
   */
  private static async failOrder(
    order: PaymentOrder,
    data: Prisma.PaymentOrderUpdateManyMutationInput,
    midtransStatus: string
  ) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.paymentOrder.updateMany({
        where: { id: order.id, status: PaymentOrderStatus.PENDING },
        data: {
          ...data,
          status: PaymentOrderStatus.FAILED,
          failedAt: new Date(),
          midtransStatus,
        },
      });
      if (updated.count > 0 && order.couponCode) {
        await CouponService.release(tx, order.orderId);
      }
      return updated;
    });
  }

  private static async settleOrder(
    order: PaymentOrder,
    payload: Record<string, unknown>,
    data: Prisma.PaymentOrderUpdateManyMutationInput
  ): Promise<PaymentApplyResult> {
    return prisma.$transaction(async (tx) => {
      const claimed = await tx.paymentOrder.updateMany({
        where: {
          id: order.id,
          status: { in: [PaymentOrderStatus.PENDING, PaymentOrderStatus.EXPIRED] },
        },
        data: {
          ...data,
          status: PaymentOrderStatus.PAID,
          paidAt: parseMidtransDate(payload.settlement_time) || new Date(),
          midtransStatus: String(payload.transaction_status ?? 'settlement'),
        },
      });

      if (claimed.count === 0) {
        const current = await tx.paymentOrder.findUnique({
          where: { id: order.id },
          select: { status: true },
        });
        if (current?.status === PaymentOrderStatus.PAID) {
          return { status: 'paid', already: true };
        }
        return { status: current?.status?.toLowerCase() || 'ignored', ignored: true };
      }

      // Kupon baru dihitung terpakai setelah uang benar-benar masuk.
      if (order.couponCode) {
        await CouponService.confirm(tx, order.orderId);
      }

      const credit = await CtfWalletService.credit(
        {
          userId: order.userId,
          amount: order.ctfAmount,
          type: 'TOPUP',
          idempotencyKey: `topup:${order.orderId}`,
          referenceType: 'payment_order',
          referenceId: order.id,
          metadata: {
            order_id: order.orderId,
            transaction_id: String(payload.transaction_id ?? ''),
            package_code: order.packageCode,
            amount_idr: order.amountIdr,
            coupon_code: order.couponCode,
            discount_idr: order.discountIdr,
          } as Prisma.InputJsonValue,
        },
        tx
      );

      return {
        status: 'paid',
        credited: !credit.idempotent,
        balance: credit.balance,
      };
    });
  }

  private static paymentDataFromPayload(
    payload: Record<string, unknown>
  ): Prisma.PaymentOrderUpdateManyMutationInput {
    const actions = actionsFrom(payload.actions);
    const qrAction = actions.find((action) => action.name === 'generate-qr-code');
    const deeplinkAction = actions.find(
      (action) => action.name === 'deeplink-redirect' || action.name === 'go-pay-deeplink'
    );
    const vaNumbers = Array.isArray(payload.va_numbers)
      ? (payload.va_numbers as Array<{ va_number?: string }>)
      : [];

    return {
      midtransTransactionId: payload.transaction_id ? String(payload.transaction_id) : undefined,
      midtransStatus: payload.transaction_status ? String(payload.transaction_status) : undefined,
      qrString: payload.qr_string ? String(payload.qr_string) : undefined,
      qrUrl: payload.qr_url
        ? String(payload.qr_url)
        : qrAction?.url
          ? String(qrAction.url)
          : undefined,
      vaNumber:
        (payload.permata_va_number ? String(payload.permata_va_number) : undefined) ||
        (vaNumbers[0]?.va_number ? String(vaNumbers[0].va_number) : undefined),
      deeplinkUrl: deeplinkAction?.url
        ? String(deeplinkAction.url)
        : payload.redirect_url
          ? String(payload.redirect_url)
          : undefined,
      billerCode: payload.biller_code ? String(payload.biller_code) : undefined,
      billKey: payload.bill_key ? String(payload.bill_key) : undefined,
      actions: payload.actions ? (payload.actions as Prisma.InputJsonValue) : undefined,
      expiresAt: parseMidtransDate(payload.expiry_time),
      rawResponse: withoutSignature(payload) as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
    };
  }

  private static async auditPaymentEvent(
    order: PaymentOrder,
    action: string,
    reason: string,
    payload: Record<string, unknown>,
    options: PaymentApplyOptions
  ) {
    await prisma.adminAuditLog
      .create({
        data: {
          action,
          targetType: 'PaymentOrder',
          targetId: order.id,
          reason,
          metadata: {
            order_id: order.orderId,
            transaction_id: payload.transaction_id ?? null,
            transaction_status: payload.transaction_status ?? null,
            source: options.source,
          } as Prisma.InputJsonValue,
          ipAddress: options.ipAddress || null,
          userAgent: options.userAgent || null,
        },
      })
      .catch(() => undefined);
  }

  private static serializeOrder(order: PaymentOrder) {
    const method = order.paymentMethod ? findPaymentMethod(order.paymentMethod) : undefined;
    const expiresAt = order.expiresAt;
    const canPay =
      order.status === PaymentOrderStatus.PENDING &&
      (!expiresAt || expiresAt.getTime() > Date.now());
    // Order lama tidak punya `gatewayMode`; perlakukan sebagai Core API agar
    // tampilannya tidak berubah setelah mode global dipindah ke Snap.
    const gatewayMode = order.gatewayMode === 'snap' ? 'snap' : 'core_api';

    let instructions: Record<string, unknown> | null = null;
    if (gatewayMode === 'snap') {
      instructions = order.snapToken
        ? {
            type: 'snap',
            token: order.snapToken,
            redirect_url: order.snapRedirectUrl,
            client_key: ENV.MIDTRANS_CLIENT_KEY || null,
            script_url: MidtransService.snapScriptUrl(),
          }
        : null;
    } else if (method?.code === 'qris') {
      instructions = {
        type: 'qris',
        qr_string: order.qrString,
        qr_url: order.qrUrl,
      };
    } else if (method?.group === 'va') {
      instructions = {
        type: method.code === 'mandiri_bill' ? 'mandiri_bill' : 'va',
        bank: order.paymentChannel,
        va_number: order.vaNumber,
        biller_code: order.billerCode,
        bill_key: order.billKey,
      };
    } else if (method?.group === 'ewallet') {
      instructions = {
        type: 'deeplink',
        url: order.deeplinkUrl,
      };
    }

    return {
      id: order.id,
      order_id: order.orderId,
      package_code: order.packageCode,
      package_name: order.packageName,
      amount_idr: order.amountIdr,
      ctf_amount: order.ctfAmount,
      coupon_code: order.couponCode,
      discount_idr: order.discountIdr,
      original_amount_idr: order.amountIdr + order.discountIdr,
      currency: order.currency,
      status: order.status.toLowerCase(),
      gateway_mode: gatewayMode,
      payment_method: order.paymentMethod,
      payment_method_label: method?.label ?? null,
      payment_channel: order.paymentChannel,
      instructions,
      can_pay: canPay,
      expires_at: order.expiresAt,
      paid_at: order.paidAt,
      refunded_at: order.refundedAt,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    };
  }
}
