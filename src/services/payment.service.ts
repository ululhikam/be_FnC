import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import type { PaymentEvent, PaymentOrder } from '@prisma/client';
import { PaymentEventStatus, PaymentOrderStatus } from '@prisma/client';
import { ENV } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import {
  BASE_REVENUE_PER_FESS_IDR,
  CTF_PER_PAID_FESS,
  PAYMENT_METHODS,
  findPaymentMethod,
  type PaymentMethodCode,
} from '../constants/payments.js';
import { parseMidtransDate } from '../utils/midtrans-date.util.js';
import { CtfWalletService } from './ctf-wallet.service.js';
import { MidtransError, MidtransService } from './midtrans.service.js';
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

function paymentChannelFor(method: PaymentMethodCode): string {
  switch (method) {
    case 'bca_va':
      return 'bca';
    case 'bni_va':
      return 'bni';
    case 'bri_va':
      return 'bri';
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
    return {
      enabled: ENV.PAYMENTS_ENABLED,
      configured: MidtransService.isConfigured(),
      currency: 'IDR',
      ctf_per_paid_fess: CTF_PER_PAID_FESS,
      base_revenue_per_paid_fess_idr: BASE_REVENUE_PER_FESS_IDR,
      packages: await PaymentPackageService.listActive(),
      methods: PAYMENT_METHODS,
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

    const existing = await prisma.paymentOrder.findUnique({
      where: { requestKey: input.requestKey },
    });
    if (existing) {
      this.assertSameRequest(existing, user.id, pkg.code, method.code);
      return { order: this.serializeOrder(existing), idempotent: true };
    }

    const orderId = `FNC-${Date.now().toString(36).toUpperCase()}-${crypto
      .randomBytes(5)
      .toString('hex')
      .toUpperCase()}`;
    const now = new Date();
    const initialExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    let order: PaymentOrder;
    try {
      order = await prisma.paymentOrder.create({
        data: {
          orderId,
          requestKey: input.requestKey,
          userId: user.id,
          packageCode: pkg.code,
          packageName: pkg.name,
          amountIdr: pkg.amountIdr,
          ctfAmount: pkg.ctfAmount,
          currency: 'IDR',
          status: PaymentOrderStatus.PENDING,
          paymentMethod: method.code,
          paymentChannel: paymentChannelFor(method.code),
          expiresAt: initialExpiry,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const raced = await prisma.paymentOrder.findUnique({
          where: { requestKey: input.requestKey },
        });
        if (raced) {
          this.assertSameRequest(raced, user.id, pkg.code, method.code);
          return { order: this.serializeOrder(raced), idempotent: true };
        }
      }
      throw error;
    }

    let result;
    try {
      result = await MidtransService.charge({
        orderId: order.orderId,
        amountIdr: order.amountIdr,
        packageCode: order.packageCode,
        packageName: order.packageName,
        method: method.code,
        customer: { name: user.username, email: user.email },
      });
    } catch (error) {
      const midtransError = error instanceof MidtransError ? error : null;
      const httpStatus = Number((midtransError?.details as any)?.httpStatus);
      const explicitRejection = httpStatus >= 400 && httpStatus < 500;
      await prisma.paymentOrder
        .update({
          where: { id: order.id },
          data: {
            status: explicitRejection ? PaymentOrderStatus.FAILED : PaymentOrderStatus.PENDING,
            failedAt: explicitRejection ? new Date() : undefined,
            midtransStatus: explicitRejection ? 'charge_rejected' : 'charge_uncertain',
            rawResponse: {
              charge_error: {
                code: midtransError?.code || 'MIDTRANS_ERROR',
                message: midtransError?.message || 'Gagal membuat transaksi Midtrans',
                httpStatus: httpStatus || null,
              },
            } as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
      throw error;
    }

    const actions = actionsFrom(result.actions);
    const qrAction = actions.find((action) => action.name === 'generate-qr-code');
    const deeplinkAction = actions.find(
      (action) => action.name === 'deeplink-redirect' || action.name === 'go-pay-deeplink'
    );

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
        expiresAt: result.expiresAt || initialExpiry,
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
          payload: payload as Prisma.InputJsonValue,
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
    method: string
  ) {
    if (
      order.userId !== userId ||
      order.packageCode !== packageCode ||
      order.paymentMethod !== method
    ) {
      throw paymentError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency-Key sudah dipakai untuk permintaan pembayaran yang berbeda',
        409
      );
    }
  }

  private static async applyStatus(
    order: PaymentOrder,
    payload: Record<string, unknown>,
    options: PaymentApplyOptions
  ): Promise<PaymentApplyResult> {
    const transactionStatus = String(payload.transaction_status ?? '').toLowerCase();
    const fraudStatus = String(payload.fraud_status ?? '').toLowerCase();
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
      await prisma.paymentOrder.updateMany({
        where: { id: order.id, status: PaymentOrderStatus.PENDING },
        data: { ...data, status: PaymentOrderStatus.FAILED, failedAt: new Date(), midtransStatus: 'deny' },
      });
      return { status: 'failed' };
    }

    if (transactionStatus === 'deny' || transactionStatus === 'cancel' || transactionStatus === 'failure') {
      await prisma.paymentOrder.updateMany({
        where: { id: order.id, status: PaymentOrderStatus.PENDING },
        data: { ...data, status: PaymentOrderStatus.FAILED, failedAt: new Date(), midtransStatus: transactionStatus },
      });
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
      rawResponse: payload as Prisma.InputJsonValue,
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

    let instructions: Record<string, unknown> | null = null;
    if (method?.code === 'qris') {
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
      currency: order.currency,
      status: order.status.toLowerCase(),
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
