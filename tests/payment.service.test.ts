import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
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

describe('PaymentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ENV.PAYMENTS_ENABLED = true;
    ENV.MIDTRANS_SERVER_KEY = 'SB-Mid-server-test';
    ENV.MIDTRANS_IS_PRODUCTION = false;
    vi.mocked(prisma.paymentOrder.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.paymentOrder.findMany).mockResolvedValue([]);
    vi.mocked(prisma.paymentOrder.count).mockResolvedValue(0);
    vi.mocked(prisma.paymentOrder.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.paymentEvent.create).mockResolvedValue(event as any);
    vi.mocked(prisma.paymentEvent.update).mockResolvedValue(event as any);
    vi.mocked(prisma.paymentEvent.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.adminAuditLog.create).mockResolvedValue({} as any);
    vi.spyOn(MidtransService, 'verifySignature').mockReturnValue(true);
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

  it('exposes packages and the payment kill switch', () => {
    ENV.PAYMENTS_ENABLED = false;
    const packages = PaymentService.getPackages();
    expect(packages.enabled).toBe(false);
    expect(packages.ctf_per_paid_fess).toBe(1);
    expect(packages.packages.map((pkg) => pkg.code)).toContain('bundling');
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
