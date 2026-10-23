import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { FessBillingService } from '../src/services/fess-billing.service.js';
import { CtfWalletService } from '../src/services/ctf-wallet.service.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    fessCharge: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../src/services/ctf-wallet.service.js', () => ({
  CtfWalletService: {
    debit: vi.fn(),
    credit: vi.fn(),
  },
}));

describe('FessBillingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('debits exactly one CTF and records a charge', async () => {
    vi.mocked(prisma.fessCharge.findUnique).mockResolvedValueOnce(null);
    vi.mocked(CtfWalletService.debit).mockResolvedValueOnce({
      walletId: 'wallet_1',
      balance: 4,
      idempotent: false,
    } as any);
    vi.mocked(prisma.fessCharge.create).mockResolvedValueOnce({} as any);

    const result = await FessBillingService.chargeForFess(prisma as any, {
      fessId: 'fess_1',
      userId: 'usr_author',
      base: { id: 'base_1', handle: '@b' },
    });

    expect(result).toMatchObject({
      amount: 1,
      balanceAfter: 4,
      idempotent: false,
    });
    expect(CtfWalletService.debit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'usr_author',
        amount: 1,
        type: 'FESS_CHARGE',
        idempotencyKey: 'fess-charge:fess_1',
        referenceType: 'fess',
        referenceId: 'fess_1',
      }),
      prisma
    );
    expect(prisma.fessCharge.create).toHaveBeenCalledWith({
      data: {
        fessId: 'fess_1',
        userId: 'usr_author',
        walletId: 'wallet_1',
        amount: 1,
        status: 'CHARGED',
        idempotencyKey: 'fess-charge:fess_1',
      },
    });
  });

  it('returns an existing charge without debiting again', async () => {
    vi.mocked(prisma.fessCharge.findUnique).mockResolvedValueOnce({
      fessId: 'fess_1',
      userId: 'usr_author',
      walletId: 'wallet_1',
      amount: 1,
      status: 'CHARGED',
    } as any);

    const result = await FessBillingService.chargeForFess(prisma as any, {
      fessId: 'fess_1',
      userId: 'usr_author',
      base: { id: 'base_1', handle: '@b' },
    });

    expect(result.idempotent).toBe(true);
    expect(CtfWalletService.debit).not.toHaveBeenCalled();
    expect(prisma.fessCharge.create).not.toHaveBeenCalled();
  });

  it('refunds a charged fess once and marks the charge REFUNDED', async () => {
    vi.mocked(prisma.fessCharge.findUnique).mockResolvedValueOnce({
      id: 'charge_1',
      userId: 'usr_author',
      amount: 1,
      status: 'CHARGED',
    } as any);
    vi.mocked(CtfWalletService.credit).mockResolvedValueOnce({
      walletId: 'wallet_1',
      balance: 5,
      idempotent: false,
    } as any);
    vi.mocked(prisma.fessCharge.update).mockResolvedValueOnce({} as any);

    const result = await FessBillingService.refundForUnpublishedFess(prisma as any, {
      fessId: 'fess_1',
      reason: 'Ditolak moderator',
    });

    expect(result).toMatchObject({ refunded: true, amount: 1, balanceAfter: 5 });
    expect(CtfWalletService.credit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'usr_author',
        amount: 1,
        type: 'FESS_REFUND',
        idempotencyKey: 'fess-refund:fess_1',
      }),
      prisma
    );
    expect(prisma.fessCharge.update).toHaveBeenCalledWith({
      where: { id: 'charge_1' },
      data: expect.objectContaining({
        status: 'REFUNDED',
        refundReason: 'Ditolak moderator',
      }),
    });
  });

  it('does not refund an already refunded or missing charge', async () => {
    vi.mocked(prisma.fessCharge.findUnique)
      .mockResolvedValueOnce({
        id: 'charge_1',
        userId: 'usr_author',
        amount: 1,
        status: 'REFUNDED',
      } as any)
      .mockResolvedValueOnce(null);

    const first = await FessBillingService.refundForUnpublishedFess(prisma as any, {
      fessId: 'fess_1',
    });
    const second = await FessBillingService.refundForUnpublishedFess(prisma as any, {
      fessId: 'fess_2',
    });

    expect(first.refunded).toBe(false);
    expect(second.refunded).toBe(false);
    expect(CtfWalletService.credit).not.toHaveBeenCalled();
  });

  it('detects refunded charges for moderation guards', async () => {
    vi.mocked(prisma.fessCharge.findUnique).mockResolvedValueOnce({
      status: 'REFUNDED',
    } as any);

    await expect(FessBillingService.hasRefundedCharge('fess_1')).resolves.toBe(true);
  });
});
