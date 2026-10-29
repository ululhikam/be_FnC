import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import { invalidateCache } from '../src/utils/cache.util.js';
import { CtfWalletService } from '../src/services/ctf-wallet.service.js';
import { MidtransService } from '../src/services/midtrans.service.js';
import { PaymentService } from '../src/services/payment.service.js';

vi.mock('../src/config/prisma.js', () => {
  const prisma: any = {
    paymentOrder: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    paymentEvent: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    paymentPackage: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    coupon: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    couponRedemption: {
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      groupBy: vi.fn(),
    },
    adminAuditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
  };
  return { prisma };
});

const order = {
  id: 'order_1',
  orderId: 'FNC-ORDER-1',
  requestKey: 'req-12345678',
  userId: 'usr_1',
  packageCode: 'coba_dulu',
  packageName: 'Coba Dulu',
  amountIdr: 5000,
  ctfAmount: 25,
  couponCode: null,
  discountIdr: 0,
  currency: 'IDR',
  status: 'PENDING',
  paymentMethod: 'qris',
  paymentChannel: 'qris',
  midtransTransactionId: null,
  midtransStatus: null,
  qrString: null,
  qrUrl: null,
  vaNumber: null,
  deeplinkUrl: null,
  billerCode: null,
  billKey: null,
  actions: null,
  expiresAt: new Date('2026-10-25T00:00:00.000Z'),
  paidAt: null,
  failedAt: null,
  refundedAt: null,
  refundedAmountIdr: null,
  refundReason: null,
  lastSyncedAt: null,
  rawResponse: null,
  createdAt: new Date('2026-10-24T00:00:00.000Z'),
  updatedAt: new Date('2026-10-24T00:00:00.000Z'),
};

const event = {
  id: 'event_1',
  paymentOrderId: null,
  orderId: order.orderId,
  eventType: 'midtrans.notification',
  status: 'RECEIVED',
  signatureValid: true,
  idempotencyKey: 'event-key',
  payload: {},
  ipAddress: null,
  userAgent: null,
  processedAt: null,
  errorMessage: null,
  createdAt: new Date(),
};

const originalEnabled = ENV.PAYMENTS_ENABLED;
const originalServerKey = ENV.MIDTRANS_SERVER_KEY;
const originalProduction = ENV.MIDTRANS_IS_PRODUCTION;

/** Baris tabel PaymentPackage yang dipakai oleh resolve paket di createOrder. */
const packageRow = {
  code: 'coba_dulu',
  name: 'Coba Dulu',
  amountIdr: 5000,
  ctfAmount: 25,
  description: 'Paket kecil untuk mencoba top-up dan publish.',
  sortOrder: 10,
  isActive: true,
  updatedById: null,
  updatedAt: new Date('2026-10-24T00:00:00.000Z'),
};

/** Kupon nominal Rp2.000 untuk paket Rp5.000. */
const couponRow = {
  code: 'HEMAT10',
  label: 'Potongan Rp2.000',
  discountType: 'FIXED',
  discountValue: 2000,
  maxDiscountIdr: null,
  minAmountIdr: 0,
  startsAt: null,
  endsAt: null,
  maxRedemptions: 100,
  redemptionCount: 0,
  maxPerUser: 1,
  isActive: true,
  createdById: null,
  updatedById: null,
  createdAt: new Date('2026-10-24T00:00:00.000Z'),
  updatedAt: new Date('2026-10-24T00:00:00.000Z'),
};

describe('PaymentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCache('payment-packages:');
    ENV.PAYMENTS_ENABLED = true;
    ENV.MIDTRANS_SERVER_KEY = 'SB-Mid-server-test';
    ENV.MIDTRANS_IS_PRODUCTION = false;
    vi.mocked(prisma.paymentPackage.findUnique).mockImplementation(
      async (args: any) =>
        (args?.where?.code === packageRow.code ? { ...packageRow } : null) as any
    );
    vi.mocked(prisma.paymentPackage.findMany).mockResolvedValue([{ ...packageRow }] as any);
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.paymentOrder.findMany).mockResolvedValue([]);
    vi.mocked(prisma.paymentOrder.count).mockResolvedValue(0);
    vi.mocked(prisma.paymentOrder.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.paymentEvent.create).mockResolvedValue(event as any);
    vi.mocked(prisma.paymentEvent.update).mockResolvedValue(event as any);
    vi.mocked(prisma.paymentEvent.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.adminAuditLog.create).mockResolvedValue({} as any);
    vi.mocked(prisma.coupon.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.coupon.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.couponRedemption.count).mockResolvedValue(0);
    vi.mocked(prisma.couponRedemption.create).mockResolvedValue({} as any);
    vi.mocked(prisma.couponRedemption.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.couponRedemption.findUnique).mockResolvedValue(null);
    vi.spyOn(MidtransService, 'verifySignature').mockReturnValue(true);
    // Klaim settlement diverifikasi ke Status API (SEC-09).
    vi.spyOn(MidtransService, 'getStatus').mockResolvedValue({
      status_code: '200',
      transaction_status: 'settlement',
      fraud_status: 'accept',
    });
    vi.spyOn(MidtransService, 'charge').mockResolvedValue({
      transactionId: 'tx-1',
      transactionStatus: 'pending',
      statusCode: '201',
      raw: { transaction_id: 'tx-1', transaction_status: 'pending' },
      expiresAt: new Date('2026-10-25T00:00:00.000Z'),
    });
    vi.spyOn(CtfWalletService, 'credit').mockResolvedValue({
      walletId: 'wallet_1',
      userId: 'usr_1',
      balance: 25,
      idempotent: false,
      entry: {
        id: 'entry_1',
        type: 'TOPUP' as any,
        amount: 25,
        balanceAfter: 25,
        idempotencyKey: 'topup:FNC-ORDER-1',
        createdAt: new Date(),
      },
    });
  });

  afterAll(() => {
    ENV.PAYMENTS_ENABLED = originalEnabled;
    ENV.MIDTRANS_SERVER_KEY = originalServerKey;
    ENV.MIDTRANS_IS_PRODUCTION = originalProduction;
  });

  it('exposes packages and the payment kill switch', async () => {
    ENV.PAYMENTS_ENABLED = false;
    const packages = await PaymentService.getPackages();
    expect(packages.enabled).toBe(false);
    expect(packages.ctf_per_paid_fess).toBe(1);
    expect(packages.packages.map((pkg) => pkg.code)).toContain('coba_dulu');
    expect(packages.methods.map((method) => method.code)).toContain('qris');
  });

  it('refuses to create an order while payments are disabled', async () => {
    ENV.PAYMENTS_ENABLED = false;
    await expect(
      PaymentService.createOrder(
        { id: 'usr_1', username: 'tester', email: 'tester@example.com' },
        { packageCode: 'coba_dulu', method: 'qris', requestKey: 'req-12345678' }
      )
    ).rejects.toMatchObject({ code: 'PAYMENTS_DISABLED', status: 503 });
    expect(prisma.paymentOrder.create).not.toHaveBeenCalled();
  });

  it('creates a PENDING order and calls Midtrans Core API once', async () => {
    vi.mocked(prisma.paymentOrder.create).mockResolvedValue(order as any);
    vi.mocked(prisma.paymentOrder.update).mockResolvedValue({
      ...order,
      midtransTransactionId: 'tx-1',
      midtransStatus: 'pending',
    } as any);

    const result = await PaymentService.createOrder(
      { id: 'usr_1', username: 'tester', email: 'tester@example.com' },
      { packageCode: 'coba_dulu', method: 'qris', requestKey: 'req-12345678' }
    );

    expect(result.idempotent).toBe(false);
    expect(result.order.order_id).toBe(order.orderId);
    expect(result.order.amount_idr).toBe(5000);
    expect(result.order.ctf_amount).toBe(25);
    expect(result.order.status).toBe('pending');
    expect(MidtransService.charge).toHaveBeenCalledOnce();
    expect(prisma.paymentOrder.create).toHaveBeenCalledOnce();
  });

  it('applies a coupon discount and reserves the quota with the order', async () => {
    vi.mocked(prisma.coupon.findUnique).mockResolvedValue(couponRow as any);
    vi.mocked(prisma.paymentOrder.create).mockResolvedValue({
      ...order,
      amountIdr: 3000,
      discountIdr: 2000,
      couponCode: 'HEMAT10',
    } as any);
    vi.mocked(prisma.paymentOrder.update).mockResolvedValue({
      ...order,
      amountIdr: 3000,
      discountIdr: 2000,
      couponCode: 'HEMAT10',
    } as any);

    const result = await PaymentService.createOrder(
      { id: 'usr_1', username: 'tester', email: 'tester@example.com' },
      {
        packageCode: 'coba_dulu',
        method: 'qris',
        requestKey: 'req-12345678',
        couponCode: 'hemat10',
      }
    );

    expect(prisma.paymentOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amountIdr: 3000,
        discountIdr: 2000,
        couponCode: 'HEMAT10',
        ctfAmount: 25,
      }),
    });
    expect(prisma.coupon.updateMany).toHaveBeenCalledWith({
      where: { code: 'HEMAT10', isActive: true, redemptionCount: { lt: 100 } },
      data: { redemptionCount: { increment: 1 } },
    });
    expect(prisma.couponRedemption.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        couponCode: 'HEMAT10',
        status: 'RESERVED',
        amountIdr: 5000,
        discountIdr: 2000,
      }),
    });
    expect(MidtransService.charge).toHaveBeenCalledWith(
      expect.objectContaining({ amountIdr: 3000 })
    );
    expect(result.order).toMatchObject({
      amount_idr: 3000,
      discount_idr: 2000,
      coupon_code: 'HEMAT10',
      original_amount_idr: 5000,
    });
  });

  it('refuses an order when the coupon quota is exhausted', async () => {
    vi.mocked(prisma.coupon.findUnique).mockResolvedValue({
      ...couponRow,
      maxRedemptions: 5,
      redemptionCount: 5,
    } as any);

    await expect(
      PaymentService.createOrder(
        { id: 'usr_1', username: 'tester', email: 'tester@example.com' },
        {
          packageCode: 'coba_dulu',
          method: 'qris',
          requestKey: 'req-12345678',
          couponCode: 'HEMAT10',
        }
      )
    ).rejects.toMatchObject({ code: 'COUPON_QUOTA_EXHAUSTED', status: 409 });

    expect(prisma.paymentOrder.create).not.toHaveBeenCalled();
    expect(prisma.couponRedemption.create).not.toHaveBeenCalled();
  });

  it('rejects replaying an Idempotency-Key with a different coupon', async () => {
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue({
      ...order,
      couponCode: 'HEMAT10',
      discountIdr: 2000,
      amountIdr: 3000,
    } as any);

    await expect(
      PaymentService.createOrder(
        { id: 'usr_1', username: 'tester', email: 'tester@example.com' },
        {
          packageCode: 'coba_dulu',
          method: 'qris',
          requestKey: 'req-12345678',
          couponCode: 'LAINNYA',
        }
      )
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
  });

  it('confirms the coupon reservation once the order is paid', async () => {
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue({
      ...order,
      amountIdr: 3000,
      discountIdr: 2000,
      couponCode: 'HEMAT10',
    } as any);

    await PaymentService.handleNotification({
      order_id: order.orderId,
      transaction_id: 'tx-1',
      transaction_status: 'settlement',
      status_code: '200',
      gross_amount: '3000.00',
      currency: 'IDR',
      fraud_status: 'accept',
      signature_key: 'valid-signature',
    });

    expect(prisma.couponRedemption.updateMany).toHaveBeenCalledWith({
      where: { orderId: order.orderId, status: 'RESERVED' },
      data: expect.objectContaining({ status: 'CONFIRMED' }),
    });
  });

  it('returns the coupon quota when the order fails', async () => {
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue({
      ...order,
      amountIdr: 3000,
      discountIdr: 2000,
      couponCode: 'HEMAT10',
    } as any);
    vi.mocked(prisma.couponRedemption.findUnique).mockResolvedValue({
      couponCode: 'HEMAT10',
      status: 'RESERVED',
    } as any);

    await PaymentService.handleNotification({
      order_id: order.orderId,
      transaction_id: 'tx-1',
      transaction_status: 'cancel',
      status_code: '200',
      gross_amount: '3000.00',
      currency: 'IDR',
      signature_key: 'valid-signature',
    });

    expect(prisma.couponRedemption.updateMany).toHaveBeenCalledWith({
      where: { orderId: order.orderId, status: 'RESERVED' },
      data: expect.objectContaining({ status: 'RELEASED' }),
    });
    expect(prisma.coupon.updateMany).toHaveBeenCalledWith({
      where: { code: 'HEMAT10', redemptionCount: { gt: 0 } },
      data: { redemptionCount: { decrement: 1 } },
    });
  });

  it('rejects replaying the same Idempotency-Key for a different package', async () => {
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue({
      ...order,
      packageCode: 'hemat',
    } as any);

    await expect(
      PaymentService.createOrder(
        { id: 'usr_1', username: 'tester', email: 'tester@example.com' },
        { packageCode: 'coba_dulu', method: 'qris', requestKey: 'req-12345678' }
      )
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
  });

  it('rejects an invalid signature before writing any payment event', async () => {
    vi.spyOn(MidtransService, 'verifySignature').mockReturnValue(false);

    await expect(
      PaymentService.handleNotification({
        order_id: order.orderId,
        transaction_status: 'settlement',
        status_code: '200',
        gross_amount: '5000.00',
        currency: 'IDR',
        signature_key: 'bad',
      })
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE', status: 401 });

    expect(prisma.paymentOrder.findUnique).not.toHaveBeenCalled();
    expect(prisma.paymentEvent.create).not.toHaveBeenCalled();
  });

  it('credits CTF exactly once for a valid settlement notification', async () => {
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue(order as any);

    const result = await PaymentService.handleNotification({
      order_id: order.orderId,
      transaction_id: 'tx-1',
      transaction_status: 'settlement',
      status_code: '200',
      gross_amount: '5000.00',
      currency: 'IDR',
      fraud_status: 'accept',
      settlement_time: '2026-10-24 13:06:27',
      expiry_time: '2026-10-25 07:00:00',
      signature_key: 'valid-signature',
    });

    expect(result).toMatchObject({ status: 'paid', credited: true, balance: 25 });
    expect(CtfWalletService.credit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'usr_1',
        amount: 25,
        type: 'TOPUP',
        idempotencyKey: 'topup:FNC-ORDER-1',
        referenceId: 'order_1',
      }),
      prisma
    );
    expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'order_1',
          status: { in: ['PENDING', 'EXPIRED'] },
        }),
        data: expect.objectContaining({
          status: 'PAID',
          paidAt: new Date('2026-10-24T06:06:27.000Z'),
          expiresAt: new Date('2026-10-25T00:00:00.000Z'),
        }),
      })
    );
    expect(prisma.paymentEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSED' }),
      })
    );
  });

  it('does not credit CTF when Midtrans still reports the order as pending', async () => {
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue(order as any);
    vi.mocked(MidtransService.getStatus).mockResolvedValueOnce({
      status_code: '200',
      transaction_status: 'pending',
      fraud_status: 'accept',
    });

    const result = await PaymentService.handleNotification({
      order_id: order.orderId,
      transaction_id: 'tx-1',
      transaction_status: 'settlement',
      status_code: '200',
      gross_amount: '5000.00',
      currency: 'IDR',
      fraud_status: 'accept',
      signature_key: 'valid-signature',
    });

    expect(result).toMatchObject({ status: 'pending' });
    expect(CtfWalletService.credit).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PAYMENT_STATUS_MISMATCH' }),
      })
    );
  });

  it('fails closed when the Status API cannot confirm a settlement', async () => {
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue(order as any);
    vi.mocked(MidtransService.getStatus).mockResolvedValueOnce(null);

    await expect(
      PaymentService.handleNotification({
        order_id: order.orderId,
        transaction_id: 'tx-1',
        transaction_status: 'settlement',
        status_code: '200',
        gross_amount: '5000.00',
        currency: 'IDR',
        signature_key: 'valid-signature',
      })
    ).rejects.toMatchObject({ code: 'PAYMENT_STATUS_UNVERIFIED', status: 502 });

    expect(CtfWalletService.credit).not.toHaveBeenCalled();
  });

  it('does not store the webhook signature in PaymentEvent', async () => {
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue(order as any);

    await PaymentService.handleNotification({
      order_id: order.orderId,
      transaction_id: 'tx-1',
      transaction_status: 'settlement',
      status_code: '200',
      gross_amount: '5000.00',
      currency: 'IDR',
      signature_key: 'valid-signature',
    });

    const createCall: any = vi.mocked(prisma.paymentEvent.create).mock.calls[0][0];
    expect(createCall.data.payload).not.toHaveProperty('signature_key');
    expect(createCall.data.payload.order_id).toBe(order.orderId);
  });

  it('does not credit CTF when the notification amount is wrong', async () => {
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue(order as any);

    await expect(
      PaymentService.handleNotification({
        order_id: order.orderId,
        transaction_id: 'tx-1',
        transaction_status: 'settlement',
        status_code: '200',
        gross_amount: '9999.00',
        currency: 'IDR',
        signature_key: 'valid-signature',
      })
    ).rejects.toMatchObject({ code: 'PAYMENT_AMOUNT_MISMATCH', status: 400 });

    expect(CtfWalletService.credit).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PAYMENT_AMOUNT_MISMATCH' }),
      })
    );
  });

  it('does not credit an unknown order and does not persist an event', async () => {
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue(null);

    const result = await PaymentService.handleNotification({
      order_id: 'FNC-UNKNOWN',
      transaction_status: 'settlement',
      status_code: '200',
      gross_amount: '5000.00',
      currency: 'IDR',
      signature_key: 'valid-signature',
    });

    expect(result).toMatchObject({ ignored: true, status: 'unknown_order' });
    expect(prisma.paymentEvent.create).not.toHaveBeenCalled();
  });

  it('marks a paid order refunded without crediting or debiting CTF', async () => {
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue({
      ...order,
      status: 'PAID',
      paidAt: new Date('2026-10-24T06:45:41.000Z'),
    } as any);

    const result = await PaymentService.handleNotification({
      order_id: order.orderId,
      transaction_id: 'tx-1',
      transaction_status: 'refund',
      status_code: '200',
      gross_amount: '5000.00',
      refund_amount: '5000.00',
      currency: 'IDR',
      signature_key: 'valid-signature',
    });

    expect(result).toMatchObject({ status: 'refunded' });
    expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'order_1',
          status: { in: ['PAID', 'PARTIAL_REFUND'] },
        }),
        data: expect.objectContaining({
          status: 'REFUNDED',
          refundedAmountIdr: 5000,
          refundReason: 'Midtrans refund',
        }),
      })
    );
    expect(CtfWalletService.credit).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PAYMENT_REFUND_RECEIVED' }),
      })
    );
  });

  it('does not audit a refund notification that made no state transition', async () => {
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue({
      ...order,
      status: 'REFUNDED',
      refundedAt: new Date('2026-10-24T06:50:44.000Z'),
    } as any);
    vi.mocked(prisma.paymentOrder.updateMany).mockResolvedValue({ count: 0 } as any);

    const result = await PaymentService.handleNotification({
      order_id: order.orderId,
      transaction_id: 'tx-1',
      transaction_status: 'refund',
      status_code: '200',
      gross_amount: '5000.00',
      refund_amount: '5000.00',
      currency: 'IDR',
      signature_key: 'valid-signature',
    });

    expect(result).toMatchObject({ status: 'refunded', ignored: true });
    expect(CtfWalletService.credit).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('marks a chargeback without crediting or debiting CTF', async () => {
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue({
      ...order,
      status: 'PAID',
      paidAt: new Date('2026-10-24T06:45:41.000Z'),
    } as any);

    const result = await PaymentService.handleNotification({
      order_id: order.orderId,
      transaction_id: 'tx-1',
      transaction_status: 'chargeback',
      status_code: '200',
      gross_amount: '5000.00',
      currency: 'IDR',
      signature_key: 'valid-signature',
    });

    expect(result).toMatchObject({ status: 'chargeback' });
    expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'order_1',
          status: 'PAID',
        }),
        data: expect.objectContaining({ status: 'CHARGEBACK' }),
      })
    );
    expect(CtfWalletService.credit).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PAYMENT_CHARGEBACK_RECEIVED' }),
      })
    );
  });

  it('does not audit a chargeback notification that made no state transition', async () => {
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue({
      ...order,
      status: 'CHARGEBACK',
    } as any);
    vi.mocked(prisma.paymentOrder.updateMany).mockResolvedValue({ count: 0 } as any);

    const result = await PaymentService.handleNotification({
      order_id: order.orderId,
      transaction_id: 'tx-1',
      transaction_status: 'chargeback',
      status_code: '200',
      gross_amount: '5000.00',
      currency: 'IDR',
      signature_key: 'valid-signature',
    });

    expect(result).toMatchObject({ status: 'chargeback', ignored: true });
    expect(CtfWalletService.credit).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });
});
