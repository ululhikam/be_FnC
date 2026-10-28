import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { ENV } from '../src/config/env.js';
import { BaseRevenueService } from '../src/services/base-revenue.service.js';
import { getBaseBillingState } from '../src/services/fess-billing.service.js';
import { comparePassword } from '../src/utils/password.util.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    base: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    baseRevenueWallet: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    baseRevenueEntry: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
    basePayout: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    fessCharge: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    adminAuditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    systemLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn((arg) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg)
    ),
  },
}));

vi.mock('../src/utils/password.util.js', () => ({
  comparePassword: vi.fn().mockResolvedValue(true),
}));

const SUPER_ADMIN = { id: 'usr_super', role: 'Super Admin', managedBases: [] };
const BASE_ADMIN = {
  id: 'usr_owner',
  role: 'Base Admin',
  managedBases: ['@b'],
};

function paidBase(overrides: Record<string, any> = {}) {
  return {
    id: 'base_1',
    handle: '@b',
    name: 'Base Satu',
    creatorId: 'usr_owner',
    freeForever: false,
    trialEndsAt: new Date(Date.now() - 1000),
    payoutKycStatus: 'verified',
    payoutBankName: 'BCA',
    payoutBankAccountName: 'Owner Base',
    payoutBankAccountNumber: '1234567890',
    payoutBankChangeEffectiveAt: new Date(Date.now() - 1000),
    payoutBankUpdatedAt: new Date(Date.now() - 10000),
    ...overrides,
  };
}

function payoutRow(overrides: Record<string, any> = {}) {
  return {
    id: 'payout_1',
    baseId: 'base_1',
    walletId: 'wallet_1',
    requestedById: 'usr_requester',
    reviewedById: null,
    amountIdr: 100_000,
    feeIdr: 0,
    netIdr: 100_000,
    status: 'REQUESTED',
    bankName: 'BCA',
    bankAccountName: 'Owner Base',
    bankAccountNumber: '1234567890',
    requestKey: 'payout-key-1',
    reference: null,
    notes: null,
    rejectionReason: null,
    requestedAt: new Date(),
    reviewedAt: null,
    paidAt: null,
    failedAt: null,
    base: { id: 'base_1', handle: '@b', name: 'Base Satu' },
    requestedBy: { handle: '@requester' },
    reviewedBy: null,
    ...overrides,
  };
}

describe('Base billing policy', () => {
  it('is free while freeForever is on', () => {
    expect(getBaseBillingState(paidBase({ freeForever: true }))).toMatchObject({
      freeForever: true,
      requiresPayment: false,
      reason: 'free_forever',
    });
  });

  it('is free during the trial and paid afterwards', () => {
    const trial = getBaseBillingState(
      paidBase({ trialEndsAt: new Date(Date.now() + 60_000) })
    );
    expect(trial).toMatchObject({ requiresPayment: false, reason: 'trial' });

    const expired = getBaseBillingState(
      paidBase({ trialEndsAt: new Date(Date.now() - 60_000) })
    );
    expect(expired).toMatchObject({ requiresPayment: true, reason: 'paid' });
  });

  it('treats a missing trial as paid', () => {
    expect(getBaseBillingState(paidBase({ trialEndsAt: null }))).toMatchObject({
      requiresPayment: true,
      reason: 'paid',
    });
  });
});

describe('BaseRevenueService accrual & reversal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ENV.BASE_PAYOUTS_ENABLED = false;
  });

  it('accrues Rp80 pending IDR for a paid, non-self fess', async () => {
    vi.mocked(prisma.baseRevenueEntry.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'entry_1' } as any);
    vi.mocked(prisma.baseRevenueWallet.upsert).mockResolvedValueOnce({
      id: 'wallet_1',
    } as any);
    vi.mocked(prisma.baseRevenueEntry.createMany).mockResolvedValueOnce({ count: 1 } as any);
    vi.mocked(prisma.baseRevenueWallet.update).mockResolvedValueOnce({} as any);

    const result = await BaseRevenueService.accrueForPublishedFess(prisma as any, {
      fess: { id: 'fess_1', userId: 'usr_author', baseHandle: '@b' },
      base: paidBase(),
      charge: { status: 'CHARGED' },
    });

    expect(result).toMatchObject({ id: 'entry_1' });
    expect(prisma.baseRevenueEntry.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            fessId: 'fess_1',
            amountIdr: 80,
            status: 'PENDING',
            type: 'EARNING',
          }),
        ],
        skipDuplicates: true,
      })
    );
    expect(prisma.baseRevenueWallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet_1' },
      data: { pendingIdr: { increment: 80 }, lifetimeIdr: { increment: 80 } },
    });

    const created = vi.mocked(prisma.baseRevenueEntry.createMany).mock.calls[0][0]!.data[0] as any;
    const holdMs = new Date(created.availableAt).getTime() - Date.now();
    expect(holdMs).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
  });

  it('does not accrue for self-posts, freeForever bases, or unpaid fesses', async () => {
    const results = await Promise.all([
      BaseRevenueService.accrueForPublishedFess(prisma as any, {
        fess: { id: 'self', userId: 'usr_owner', baseHandle: '@b' },
        base: paidBase(),
        charge: { status: 'CHARGED' },
      }),
      BaseRevenueService.accrueForPublishedFess(prisma as any, {
        fess: { id: 'free', userId: 'usr_author', baseHandle: '@b' },
        base: paidBase({ freeForever: true }),
        charge: { status: 'CHARGED' },
      }),
      BaseRevenueService.accrueForPublishedFess(prisma as any, {
        fess: { id: 'trial', userId: 'usr_author', baseHandle: '@b' },
        base: paidBase(),
        charge: null,
      }),
    ]);

    expect(results).toEqual([null, null, null]);
    expect(prisma.baseRevenueEntry.createMany).not.toHaveBeenCalled();
  });

  it('reverses a pending earning from pending and lifetime', async () => {
    vi.mocked(prisma.baseRevenueEntry.findUnique).mockResolvedValueOnce({
      id: 'entry_1',
      walletId: 'wallet_1',
      amountIdr: 80,
      status: 'PENDING',
      type: 'EARNING',
    } as any);
    vi.mocked(prisma.baseRevenueEntry.updateMany).mockResolvedValueOnce({ count: 1 } as any);
    vi.mocked(prisma.baseRevenueWallet.update).mockResolvedValueOnce({} as any);

    const result = await BaseRevenueService.reverseForFess(prisma as any, {
      fessId: 'fess_1',
      reason: 'diturunkan',
      reversedById: 'usr_super',
    });

    expect(result).toMatchObject({ status: 'REVERSED', amountIdr: 80 });
    expect(prisma.baseRevenueWallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet_1' },
      data: {
        pendingIdr: { decrement: 80 },
        lifetimeIdr: { decrement: 80 },
      },
    });
  });

  it('reverses an available earning from available and lifetime', async () => {
    vi.mocked(prisma.baseRevenueEntry.findUnique).mockResolvedValueOnce({
      id: 'entry_1',
      walletId: 'wallet_1',
      amountIdr: 80,
      status: 'AVAILABLE',
      type: 'EARNING',
    } as any);
    vi.mocked(prisma.baseRevenueEntry.updateMany).mockResolvedValueOnce({ count: 1 } as any);
    vi.mocked(prisma.baseRevenueWallet.update).mockResolvedValueOnce({} as any);

    await BaseRevenueService.reverseForFess(prisma as any, {
      fessId: 'fess_1',
      reason: 'diturunkan',
    });

    expect(prisma.baseRevenueWallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet_1' },
      data: {
        availableIdr: { decrement: 80 },
        lifetimeIdr: { decrement: 80 },
      },
    });
  });

  it('does not reverse an already reversed earning', async () => {
    vi.mocked(prisma.baseRevenueEntry.findUnique).mockResolvedValueOnce({
      id: 'entry_1',
      walletId: 'wallet_1',
      amountIdr: 80,
      status: 'REVERSED',
      type: 'EARNING',
    } as any);

    const result = await BaseRevenueService.reverseForFess(prisma as any, {
      fessId: 'fess_1',
      reason: 'double',
    });

    expect(result).toBeNull();
    expect(prisma.baseRevenueEntry.updateMany).not.toHaveBeenCalled();
  });

  it('releases matured pending entries exactly once', async () => {
    vi.mocked(prisma.baseRevenueEntry.findMany).mockResolvedValueOnce([
      { id: 'entry_1', walletId: 'wallet_1', amountIdr: 80 },
    ] as any);
    vi.mocked(prisma.baseRevenueEntry.updateMany).mockResolvedValueOnce({ count: 1 } as any);
    vi.mocked(prisma.baseRevenueWallet.update).mockResolvedValueOnce({} as any);

    const result = await BaseRevenueService.releaseMatured();

    expect(result.released).toBe(1);
    expect(prisma.baseRevenueWallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet_1' },
      data: {
        pendingIdr: { decrement: 80 },
        availableIdr: { increment: 80 },
      },
    });
  });
});

describe('BaseRevenueService payout workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ENV.BASE_PAYOUTS_ENABLED = true;
    ENV.BASE_PAYOUT_FEE_IDR = 6500;
  });

  it('reserves available balance and snapshots the bank when requesting a payout', async () => {
    vi.mocked(prisma.basePayout.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.base.findUnique).mockResolvedValueOnce(paidBase() as any);
    vi.mocked(prisma.baseRevenueWallet.findUnique).mockResolvedValueOnce({
      id: 'wallet_1',
      availableIdr: 100_000,
    } as any);
    vi.mocked(prisma.baseRevenueWallet.updateMany).mockResolvedValueOnce({ count: 1 } as any);
    vi.mocked(prisma.basePayout.create).mockResolvedValueOnce(
      payoutRow({ bankAccountNumber: '1234567890', status: 'REQUESTED' }) as any
    );

    const result = await BaseRevenueService.requestPayout(
      BASE_ADMIN,
      {
        amountIdr: 50_000,
        baseHandle: '@b',
        requestKey: 'payout-key-1',
        notes: 'Tarik revenue',
      },
      { ipAddress: '127.0.0.1', userAgent: 'vitest' }
    );

    expect(result.idempotent).toBe(false);
    expect(prisma.baseRevenueWallet.updateMany).toHaveBeenCalledWith({
      where: { id: 'wallet_1', availableIdr: { gte: 50_000 } },
      data: {
        availableIdr: { decrement: 50_000 },
        reservedIdr: { increment: 50_000 },
      },
    });
    expect(prisma.basePayout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountIdr: 50_000,
          feeIdr: 0,
          netIdr: 50_000,
          status: 'REQUESTED',
          requestKey: 'payout-key-1',
          bankAccountNumber: '1234567890',
        }),
      })
    );
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BASE_PAYOUT_REQUESTED',
          actorId: 'usr_owner',
        }),
      })
    );
  });

  it('rejects a payout below the Rp50.000 minimum', async () => {
    await expect(
      BaseRevenueService.requestPayout(BASE_ADMIN, {
        amountIdr: 49_999,
        baseHandle: '@b',
        requestKey: 'small',
      })
    ).rejects.toMatchObject({ code: 'PAYOUT_AMOUNT_INVALID', status: 422 });
  });

  it('rejects a payout when available revenue is insufficient', async () => {
    vi.mocked(prisma.basePayout.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.base.findUnique).mockResolvedValueOnce(paidBase() as any);
    vi.mocked(prisma.baseRevenueWallet.findUnique).mockResolvedValueOnce({
      id: 'wallet_1',
      availableIdr: 10_000,
    } as any);

    await expect(
      BaseRevenueService.requestPayout(BASE_ADMIN, {
        amountIdr: 50_000,
        baseHandle: '@b',
        requestKey: 'insufficient',
      })
    ).rejects.toMatchObject({ code: 'PAYOUT_INSUFFICIENT', status: 402 });

    expect(prisma.baseRevenueWallet.updateMany).not.toHaveBeenCalled();
  });

  it('returns the existing payout for an idempotent request key', async () => {
    vi.mocked(prisma.basePayout.findUnique).mockResolvedValueOnce(
      payoutRow({ requestedById: 'usr_owner', amountIdr: 50_000 }) as any
    );

    const result = await BaseRevenueService.requestPayout(BASE_ADMIN, {
      amountIdr: 50_000,
      baseHandle: '@b',
      requestKey: 'payout-key-1',
    });

    expect(result.idempotent).toBe(true);
    expect(prisma.basePayout.create).not.toHaveBeenCalled();
    expect(prisma.baseRevenueWallet.updateMany).not.toHaveBeenCalled();
  });

  it('blocks self-approval before re-auth', async () => {
    vi.mocked(prisma.basePayout.findUnique).mockResolvedValueOnce(
      payoutRow({ requestedById: 'usr_super' }) as any
    );

    await expect(
      BaseRevenueService.reviewPayout(SUPER_ADMIN, 'payout_1', 'approve', {
        password: 'secret',
      })
    ).rejects.toMatchObject({ code: 'PAYOUT_SELF_APPROVAL', status: 403 });

    expect(prisma.basePayout.updateMany).not.toHaveBeenCalled();
  });

  it('requires a valid password for approve and applies the transfer fee', async () => {
    vi.mocked(prisma.basePayout.findUnique).mockResolvedValueOnce(payoutRow() as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      password: 'hashed',
      isBanned: false,
    } as any);
    vi.mocked(comparePassword).mockResolvedValueOnce(true);
    vi.mocked(prisma.basePayout.updateMany).mockResolvedValueOnce({ count: 1 } as any);
    vi.mocked(prisma.basePayout.findUniqueOrThrow).mockResolvedValueOnce(
      payoutRow({
        status: 'APPROVED',
        feeIdr: 6500,
        netIdr: 93_500,
        reviewedById: 'usr_super',
        reviewedAt: new Date(),
      }) as any
    );

    const result = await BaseRevenueService.reviewPayout(
      SUPER_ADMIN,
      'payout_1',
      'approve',
      { password: 'secret', feeIdr: 6500 }
    );

    expect(result).toMatchObject({ status: 'approved', fee_idr: 6500, net_idr: 93_500 });
    expect(prisma.basePayout.updateMany).toHaveBeenCalledWith({
      where: { id: 'payout_1', status: 'REQUESTED' },
      data: expect.objectContaining({
        status: 'APPROVED',
        feeIdr: 6500,
        netIdr: 93_500,
      }),
    });
    expect(prisma.adminAuditLog.create).toHaveBeenCalled();
  });

  it('rejects a payout and returns the reserved balance', async () => {
    vi.mocked(prisma.basePayout.findUnique).mockResolvedValueOnce(payoutRow() as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      password: 'hashed',
      isBanned: false,
    } as any);
    vi.mocked(comparePassword).mockResolvedValueOnce(true);
    vi.mocked(prisma.basePayout.updateMany).mockResolvedValueOnce({ count: 1 } as any);
    vi.mocked(prisma.baseRevenueWallet.update).mockResolvedValueOnce({} as any);
    vi.mocked(prisma.basePayout.findUniqueOrThrow).mockResolvedValueOnce(
      payoutRow({ status: 'REJECTED', rejectionReason: 'Rekening tidak valid' }) as any
    );

    const result = await BaseRevenueService.reviewPayout(
      SUPER_ADMIN,
      'payout_1',
      'reject',
      { reason: 'Rekening tidak valid', password: 'secret' }
    );

    expect(result.status).toBe('rejected');
    expect(prisma.baseRevenueWallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet_1' },
      data: {
        availableIdr: { increment: 100_000 },
        reservedIdr: { decrement: 100_000 },
      },
    });
  });

  it('marks an approved payout as paid only with a transfer reference', async () => {
    vi.mocked(prisma.basePayout.findUnique).mockResolvedValueOnce(
      payoutRow({ status: 'APPROVED', reviewedAt: new Date() }) as any
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      password: 'hashed',
      isBanned: false,
    } as any);
    vi.mocked(comparePassword).mockResolvedValueOnce(true);
    vi.mocked(prisma.basePayout.updateMany).mockResolvedValueOnce({ count: 1 } as any);
    vi.mocked(prisma.basePayout.findUniqueOrThrow).mockResolvedValueOnce(
      payoutRow({ status: 'PAID', reference: 'TRX-123', paidAt: new Date() }) as any
    );

    const result = await BaseRevenueService.reviewPayout(
      SUPER_ADMIN,
      'payout_1',
      'mark_paid',
      { password: 'secret', reference: 'TRX-123' }
    );

    expect(result).toMatchObject({ status: 'paid', reference: 'TRX-123' });
    expect(prisma.baseRevenueWallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet_1' },
      data: { reservedIdr: { decrement: 100_000 } },
    });
  });

  it('marks an approved payout failed and returns the reserved balance', async () => {
    vi.mocked(prisma.basePayout.findUnique).mockResolvedValueOnce(
      payoutRow({ status: 'APPROVED', reviewedAt: new Date() }) as any
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      password: 'hashed',
      isBanned: false,
    } as any);
    vi.mocked(comparePassword).mockResolvedValueOnce(true);
    vi.mocked(prisma.basePayout.updateMany).mockResolvedValueOnce({ count: 1 } as any);
    vi.mocked(prisma.baseRevenueWallet.update).mockResolvedValueOnce({} as any);
    vi.mocked(prisma.basePayout.findUniqueOrThrow).mockResolvedValueOnce(
      payoutRow({ status: 'FAILED', rejectionReason: 'Bank menolak' }) as any
    );

    const result = await BaseRevenueService.reviewPayout(
      SUPER_ADMIN,
      'payout_1',
      'mark_failed',
      { reason: 'Bank menolak', password: 'secret' }
    );

    expect(result.status).toBe('failed');
    expect(prisma.baseRevenueWallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet_1' },
      data: {
        availableIdr: { increment: 100_000 },
        reservedIdr: { decrement: 100_000 },
      },
    });
  });

  it('keeps payouts disabled while the kill switch is off', async () => {
    ENV.BASE_PAYOUTS_ENABLED = false;
    await expect(
      BaseRevenueService.requestPayout(BASE_ADMIN, {
        amountIdr: 50_000,
        baseHandle: '@b',
        requestKey: 'off',
      })
    ).rejects.toMatchObject({ code: 'PAYOUTS_DISABLED', status: 503 });
  });
});

describe('BaseRevenueService admin controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ENV.BASE_PAYOUTS_ENABLED = false;
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      password: 'hashed',
      isBanned: false,
    } as any);
    vi.mocked(comparePassword).mockResolvedValue(true);
  });

  it('allows only Super Admin to set freeForever and writes audit + alert', async () => {
    await expect(
      BaseRevenueService.setFreeForever(
        BASE_ADMIN,
        {
          baseHandle: '@b',
          freeForever: true,
          reason: 'Mitra komunitas',
          password: 'secret',
        },
        {}
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      password: 'hashed',
      isBanned: false,
    } as any);
    vi.mocked(comparePassword).mockResolvedValueOnce(true);
    vi.mocked(prisma.base.findUnique).mockResolvedValueOnce(paidBase() as any);
    vi.mocked(prisma.base.update).mockResolvedValueOnce(
      paidBase({ freeForever: true, freeForeverReason: 'Mitra komunitas' }) as any
    );

    const result = await BaseRevenueService.setFreeForever(
      SUPER_ADMIN,
      {
        baseHandle: '@b',
        freeForever: true,
        reason: 'Mitra komunitas',
        password: 'secret',
      },
      { ipAddress: '127.0.0.1', userAgent: 'vitest' }
    );

    expect(result.free_forever).toBe(true);
    expect(result.fess_price_ctf).toBe(0);
    expect(prisma.base.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          freeForever: true,
          freeForeverReason: 'Mitra komunitas',
          freeForeverSetById: 'usr_super',
        }),
      })
    );
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BASE_FREE_FOREVER_UPDATED',
          actorId: 'usr_super',
          reason: 'Mitra komunitas',
        }),
      })
    );
    expect(prisma.systemLog.create).toHaveBeenCalled();
  });

  it('reports the platform fess price when a base is not free forever', async () => {
    vi.mocked(prisma.base.findUnique).mockResolvedValueOnce(paidBase() as any);
    vi.mocked(prisma.base.update).mockResolvedValueOnce(paidBase() as any);

    const result = await BaseRevenueService.setFreeForever(
      SUPER_ADMIN,
      {
        baseHandle: '@b',
        freeForever: false,
        reason: 'Kembali berbayar',
        password: 'secret',
      },
      {}
    );

    expect(result.free_forever).toBe(false);
    expect(result.fess_price_ctf).toBe(1);
  });

  it('requires re-auth before changing bank details and applies a 24h hold', async () => {
    vi.mocked(comparePassword).mockResolvedValueOnce(false);

    await expect(
      BaseRevenueService.updateBank(
        BASE_ADMIN,
        {
          baseHandle: '@b',
          bankName: 'BNI',
          bankAccountName: 'Owner Base',
          bankAccountNumber: '9876543210',
          password: 'wrong',
        },
        {}
      )
    ).rejects.toMatchObject({ code: 'REAUTH_INVALID', status: 403 });

    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      password: 'hashed',
      isBanned: false,
    } as any);
    vi.mocked(comparePassword).mockResolvedValueOnce(true);
    vi.mocked(prisma.base.findUnique).mockResolvedValueOnce(paidBase() as any);
    vi.mocked(prisma.base.update).mockResolvedValueOnce(
      paidBase({
        payoutBankName: 'BNI',
        payoutBankAccountNumber: '9876543210',
        payoutBankChangeEffectiveAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }) as any
    );

    const result = await BaseRevenueService.updateBank(
      BASE_ADMIN,
      {
        baseHandle: '@b',
        bankName: 'BNI',
        bankAccountName: 'Owner Base',
        bankAccountNumber: '9876543210',
        password: 'secret',
      },
      {}
    );

    expect(result.bank_change_pending).toBe(true);
    expect(result.bank_account_number_masked).toBe('******3210');
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'BASE_BANK_DETAILS_UPDATED' }),
      })
    );
  });

  it('lets only Super Admin verify KYC', async () => {
    await expect(
      BaseRevenueService.setKyc(
        BASE_ADMIN,
        {
          baseHandle: '@b',
          status: 'verified',
          password: 'secret',
        },
        {}
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      password: 'hashed',
      isBanned: false,
    } as any);
    vi.mocked(comparePassword).mockResolvedValueOnce(true);
    vi.mocked(prisma.base.findUnique).mockResolvedValueOnce(paidBase() as any);
    vi.mocked(prisma.base.update).mockResolvedValueOnce(
      paidBase({ payoutKycStatus: 'verified' }) as any
    );

    const result = await BaseRevenueService.setKyc(
      SUPER_ADMIN,
      {
        baseHandle: '@b',
        status: 'verified',
        note: 'KTP sesuai',
        password: 'secret',
      },
      {}
    );

    expect(result.payout_kyc_status).toBe('verified');
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'BASE_PAYOUT_KYC_UPDATED' }),
      })
    );
  });
});
