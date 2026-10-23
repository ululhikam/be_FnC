import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { CTF_PER_PAID_FESS } from '../constants/payments.js';
import { CtfWalletService } from './ctf-wallet.service.js';

export type BaseBillingRecord = {
  id: string;
  handle: string;
  creatorId?: string | null;
  freeForever?: boolean | null;
  trialEndsAt?: Date | string | null;
};

export type BaseBillingState = {
  freeForever: boolean;
  trialActive: boolean;
  requiresPayment: boolean;
  reason: 'free_forever' | 'trial' | 'paid';
};

export type FessChargeResult = {
  fessId: string;
  userId: string;
  walletId: string;
  amount: number;
  balanceAfter: number;
  idempotent: boolean;
};

function asTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * Single source of truth for whether posting to a base costs CTF.
 * - freeForever: never charge.
 * - active trial: never charge.
 * - everything else (including bases without a trial): paid.
 */
export function getBaseBillingState(
  base: BaseBillingRecord,
  now = new Date()
): BaseBillingState {
  const freeForever = base.freeForever === true;
  const trialEnd = asTime(base.trialEndsAt);
  const trialActive = trialEnd !== null && trialEnd > now.getTime();

  if (freeForever) {
    return { freeForever, trialActive, requiresPayment: false, reason: 'free_forever' };
  }
  if (trialActive) {
    return { freeForever, trialActive, requiresPayment: false, reason: 'trial' };
  }
  return { freeForever, trialActive, requiresPayment: true, reason: 'paid' };
}

/**
 * Fess billing is intentionally separate from payment order settlement. A fess
 * charge is exactly one CTF, debited in the same database transaction that
 * creates the fess. The unique fessId/idempotency keys make retries safe.
 */
export class FessBillingService {
  static async chargeForFess(
    tx: Prisma.TransactionClient,
    input: {
      fessId: string;
      userId: string;
      base: { id: string; handle: string };
      amount?: number;
    }
  ): Promise<FessChargeResult> {
    const amount = input.amount ?? CTF_PER_PAID_FESS;
    const existing = await tx.fessCharge.findUnique({
      where: { fessId: input.fessId },
      select: {
        userId: true,
        walletId: true,
        amount: true,
        status: true,
        fessId: true,
      },
    });

    if (existing) {
      return {
        fessId: input.fessId,
        userId: existing.userId,
        walletId: existing.walletId,
        amount: existing.amount,
        balanceAfter: 0,
        idempotent: true,
      };
    }

    const debit = await CtfWalletService.debit(
      {
        userId: input.userId,
        amount,
        type: 'FESS_CHARGE',
        idempotencyKey: `fess-charge:${input.fessId}`,
        referenceType: 'fess',
        referenceId: input.fessId,
        metadata: {
          base_id: input.base.id,
          base_handle: input.base.handle,
          kind: 'paid_fess',
        },
      },
      tx
    );

    await tx.fessCharge.create({
      data: {
        fessId: input.fessId,
        userId: input.userId,
        walletId: debit.walletId,
        amount,
        status: 'CHARGED',
        idempotencyKey: `fess-charge:${input.fessId}`,
      },
    });

    return {
      fessId: input.fessId,
      userId: input.userId,
      walletId: debit.walletId,
      amount,
      balanceAfter: debit.balance,
      idempotent: debit.idempotent,
    };
  }

  /**
   * Refund a fess only when moderation removed it before it became public.
   * The idempotency key and charge status guard against a double refund.
   */
  static async refundForUnpublishedFess(
    tx: Prisma.TransactionClient,
    input: { fessId: string; reason?: string }
  ) {
    const charge = await tx.fessCharge.findUnique({
      where: { fessId: input.fessId },
      select: {
        id: true,
        userId: true,
        amount: true,
        status: true,
      },
    });

    if (!charge || charge.status !== 'CHARGED') {
      return { refunded: false as const, amount: 0 };
    }

    const credit = await CtfWalletService.credit(
      {
        userId: charge.userId,
        amount: charge.amount,
        type: 'FESS_REFUND',
        idempotencyKey: `fess-refund:${input.fessId}`,
        referenceType: 'fess',
        referenceId: input.fessId,
        metadata: {
          kind: 'unpublished_fess_refund',
          reason: input.reason || 'Fess ditolak atau dihapus sebelum terbit',
        },
      },
      tx
    );

    await tx.fessCharge.update({
      where: { id: charge.id },
      data: {
        status: 'REFUNDED',
        refundedAt: new Date(),
        refundReason: input.reason || 'Fess ditolak atau dihapus sebelum terbit',
      },
    });

    return {
      refunded: true as const,
      amount: charge.amount,
      balanceAfter: credit.balance,
    };
  }

  static async hasRefundedCharge(fessId: string) {
    const charge = await prisma.fessCharge.findUnique({
      where: { fessId },
      select: { status: true },
    });
    return charge?.status === 'REFUNDED';
  }
}
