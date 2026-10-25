import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { ENV } from '../config/env.js';
import {
  BASE_PAYOUT_MIN_IDR,
  BASE_REVENUE_HOLD_DAYS,
  BASE_REVENUE_PER_FESS_IDR,
} from '../constants/payments.js';
import { normalizeHandle } from '../utils/format.util.js';
import { AdminSecurityService } from './admin-security.service.js';

type DbClient = Prisma.TransactionClient | typeof prisma;

export type RevenueCurrentUser = {
  id: string;
  role: string;
  managedBases?: string[];
};

export type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type BaseBillingSummary = {
  id: string;
  handle: string;
  name: string;
  creator_id: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  trial_source: string | null;
  free_forever: boolean;
  free_forever_reason: string | null;
  free_forever_set_at: string | null;
  payout_kyc_status: string;
  payout_kyc_verified_at: string | null;
  payout_kyc_note: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_account_number_masked: string | null;
  bank_updated_at: string | null;
  bank_change_effective_at: string | null;
  bank_change_pending: boolean;
  payout_ready: boolean;
};

function fail(status: number, code: string, message: string): never {
  const error: any = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function asIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function maskAccountNumber(value: string | null | undefined) {
  if (!value) return null;
  const clean = value.replace(/\s+/g, '');
  if (clean.length <= 4) return `****${clean}`;
  return `${'*'.repeat(Math.max(0, clean.length - 4))}${clean.slice(-4)}`;
}

function assertAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < BASE_PAYOUT_MIN_IDR) {
    fail(
      422,
      'PAYOUT_AMOUNT_INVALID',
      `Minimal penarikan adalah Rp${BASE_PAYOUT_MIN_IDR.toLocaleString('id-ID')}`
    );
  }
}

export class BaseRevenueService {
  /**
   * Create a pending IDR earning for a published fess. CTF is never touched
   * here: revenue is a separate, non-cashable-by-user ledger owned by the base.
   */
  static async accrueForPublishedFess(
    tx: Prisma.TransactionClient,
    input: {
      fess: {
        id: string;
        userId?: string | null;
        baseId?: string | null;
        baseHandle: string;
      };
      base: {
        id: string;
        handle: string;
        creatorId?: string | null;
        freeForever?: boolean | null;
      };
      charge?: { status: string; amount?: number } | null;
    }
  ) {
    const { fess, base } = input;

    // Free-forever bases never generate revenue.
    if (base.freeForever === true) return null;
    // No creator means there is no wallet owner to pay.
    if (!base.creatorId) return null;
    // Self-posts by the base creator/admin never generate base revenue.
    if (fess.userId && fess.userId === base.creatorId) return null;

    const charge =
      input.charge === undefined
        ? await tx.fessCharge.findUnique({
            where: { fessId: fess.id },
            select: { status: true, amount: true },
          })
        : input.charge;
    if (!charge || charge.status !== 'CHARGED') return null;

    const existing = await tx.baseRevenueEntry.findUnique({
      where: { fessId: fess.id },
      select: { id: true },
    });
    if (existing) return null;

    const wallet = await tx.baseRevenueWallet.upsert({
      where: { baseId: base.id },
      create: { baseId: base.id },
      update: {},
      select: { id: true },
    });

    const amountIdr = BASE_REVENUE_PER_FESS_IDR;
    const availableAt = new Date(
      Date.now() + BASE_REVENUE_HOLD_DAYS * 24 * 60 * 60 * 1000
    );

    // createMany + skipDuplicates keeps this idempotent without aborting the
    // surrounding transaction if two approvals race on the same fess.
    const created = await tx.baseRevenueEntry.createMany({
      data: [
        {
          id: crypto.randomUUID(),
          walletId: wallet.id,
          baseId: base.id,
          fessId: fess.id,
          type: 'EARNING',
          amountIdr,
          status: 'PENDING',
          availableAt,
          idempotencyKey: `base-revenue:fess:${fess.id}`,
          metadata: {
            fess_id: fess.id,
            base_handle: base.handle,
            author_id: fess.userId ?? null,
            revenue_idr: amountIdr,
            hold_days: BASE_REVENUE_HOLD_DAYS,
          },
        },
      ],
      skipDuplicates: true,
    });

    if (created.count !== 1) return null;

    await tx.baseRevenueWallet.update({
      where: { id: wallet.id },
      data: {
        pendingIdr: { increment: amountIdr },
        lifetimeIdr: { increment: amountIdr },
      },
    });

    return tx.baseRevenueEntry.findUnique({ where: { fessId: fess.id } });
  }

  /**
   * Reverse a base earning when its fess is taken down. If the earning was
   * already available, available balance may become negative; payout requests
   * fail while available is below the minimum, which prevents overpayment.
   */
  static async reverseForFess(
    tx: Prisma.TransactionClient,
    input: {
      fessId: string;
      reason: string;
      reversedById?: string | null;
    }
  ) {
    const entry = await tx.baseRevenueEntry.findUnique({
      where: { fessId: input.fessId },
      select: {
        id: true,
        walletId: true,
        amountIdr: true,
        status: true,
        type: true,
      },
    });
    if (!entry || entry.status === 'REVERSED' || entry.type !== 'EARNING') return null;

    const changed = await tx.baseRevenueEntry.updateMany({
      where: { id: entry.id, status: { not: 'REVERSED' } },
      data: {
        status: 'REVERSED',
        reversedAt: new Date(),
        reversalReason: input.reason,
        reversedById: input.reversedById ?? null,
      },
    });
    if (changed.count !== 1) return null;

    const walletData: Prisma.BaseRevenueWalletUpdateInput =
      entry.status === 'PENDING'
        ? {
            pendingIdr: { decrement: entry.amountIdr },
            lifetimeIdr: { decrement: entry.amountIdr },
          }
        : {
            availableIdr: { decrement: entry.amountIdr },
            lifetimeIdr: { decrement: entry.amountIdr },
          };

    await tx.baseRevenueWallet.update({
      where: { id: entry.walletId },
      data: walletData,
    });

    return { id: entry.id, amountIdr: entry.amountIdr, status: 'REVERSED' };
  }

  /** Move matured pending earnings into the available balance. */
  static async releaseMatured(baseId?: string, limit = 200) {
    return prisma.$transaction(async (tx) => {
      const due = await tx.baseRevenueEntry.findMany({
        where: {
          status: 'PENDING',
          availableAt: { lte: new Date() },
          ...(baseId ? { baseId } : {}),
        },
        orderBy: { availableAt: 'asc' },
        take: Math.min(Math.max(limit, 1), 500),
        select: { id: true, walletId: true, amountIdr: true },
      });

      let released = 0;
      for (const entry of due) {
        const changed = await tx.baseRevenueEntry.updateMany({
          where: { id: entry.id, status: 'PENDING' },
          data: { status: 'AVAILABLE' },
        });
        if (changed.count !== 1) continue;

        await tx.baseRevenueWallet.update({
          where: { id: entry.walletId },
          data: {
            pendingIdr: { decrement: entry.amountIdr },
            availableIdr: { increment: entry.amountIdr },
          },
        });
        released += 1;
      }

      return { released };
    });
  }

  private static async resolveBase(
    currentUser: RevenueCurrentUser,
    baseHandle?: string | null
  ) {
    const cleanHandle = baseHandle ? normalizeHandle(baseHandle) : undefined;
    if (cleanHandle) {
      const base = await prisma.base.findUnique({ where: { handle: cleanHandle } });
      if (!base) fail(404, 'BASE_NOT_FOUND', 'Base tidak ditemukan');
      this.assertBaseAccess(currentUser, base);
      return base;
    }

    if (currentUser.role === 'Super Admin') {
      return prisma.base.findFirst({ orderBy: { createdAt: 'asc' } });
    }

    const managedHandles = currentUser.managedBases || [];
    return prisma.base.findFirst({
      where: {
        OR: [
          { creatorId: currentUser.id },
          ...(managedHandles.length > 0 ? [{ handle: { in: managedHandles } }] : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private static assertBaseAccess(
    currentUser: RevenueCurrentUser,
    base: { handle: string; creatorId: string | null }
  ) {
    if (currentUser.role === 'Super Admin') return;
    const managed = currentUser.managedBases || [];
    if (base.creatorId !== currentUser.id && !managed.includes(base.handle)) {
      fail(403, 'FORBIDDEN', 'Anda tidak memiliki akses ke revenue base ini');
    }
  }

  private static serializeBase(
    base: any,
    options: { revealBank?: boolean } = {}
  ): BaseBillingSummary {
    const now = Date.now();
    const effectiveAt = base.payoutBankChangeEffectiveAt
      ? new Date(base.payoutBankChangeEffectiveAt).getTime()
      : null;
    const bankComplete = Boolean(
      base.payoutBankName && base.payoutBankAccountName && base.payoutBankAccountNumber
    );
    const kycVerified = base.payoutKycStatus === 'verified';

    return {
      id: base.id,
      handle: base.handle,
      name: base.name,
      creator_id: base.creatorId ?? null,
      trial_started_at: asIso(base.trialStartedAt),
      trial_ends_at: asIso(base.trialEndsAt),
      trial_source: base.trialSource ?? null,
      free_forever: base.freeForever === true,
      free_forever_reason: base.freeForeverReason ?? null,
      free_forever_set_at: asIso(base.freeForeverSetAt),
      payout_kyc_status: base.payoutKycStatus || 'unverified',
      payout_kyc_verified_at: asIso(base.payoutKycVerifiedAt),
      payout_kyc_note: base.payoutKycNote ?? null,
      bank_name: base.payoutBankName ?? null,
      bank_account_name: base.payoutBankAccountName ?? null,
      bank_account_number:
        options.revealBank === true ? base.payoutBankAccountNumber ?? null : null,
      bank_account_number_masked: maskAccountNumber(base.payoutBankAccountNumber),
      bank_updated_at: asIso(base.payoutBankUpdatedAt),
      bank_change_effective_at: asIso(base.payoutBankChangeEffectiveAt),
      bank_change_pending: effectiveAt !== null && effectiveAt > now,
      payout_ready: Boolean(bankComplete && kycVerified && (!effectiveAt || effectiveAt <= now)),
    };
  }

  private static serializePayout(payout: any, revealBank = false) {
    return {
      id: payout.id,
      status: String(payout.status).toLowerCase(),
      base_handle: payout.base?.handle ?? null,
      base_name: payout.base?.name ?? null,
      amount_idr: payout.amountIdr,
      fee_idr: payout.feeIdr,
      net_idr: payout.netIdr,
      bank_name: payout.bankName,
      bank_account_name: payout.bankAccountName,
      bank_account_number: revealBank ? payout.bankAccountNumber : null,
      bank_account_number_masked: maskAccountNumber(payout.bankAccountNumber),
      reference: payout.reference ?? null,
      notes: payout.notes ?? null,
      rejection_reason: payout.rejectionReason ?? null,
      requested_at: asIso(payout.requestedAt),
      reviewed_at: asIso(payout.reviewedAt),
      paid_at: asIso(payout.paidAt),
      failed_at: asIso(payout.failedAt),
      requested_by: payout.requestedBy?.handle ?? payout.requestedById ?? null,
      reviewed_by: payout.reviewedBy?.handle ?? payout.reviewedById ?? null,
    };
  }

  static async getWorkspace(
    currentUser: RevenueCurrentUser,
    baseHandle?: string | null
  ) {
    if (currentUser.role === 'Super Admin' && !baseHandle) {
      await this.releaseMatured();
      const bases = await prisma.base.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          handle: true,
          name: true,
          creatorId: true,
          trialStartedAt: true,
          trialEndsAt: true,
          trialSource: true,
          freeForever: true,
          freeForeverReason: true,
          freeForeverSetAt: true,
          payoutKycStatus: true,
          payoutKycVerifiedAt: true,
          payoutKycNote: true,
          payoutBankName: true,
          payoutBankAccountName: true,
          payoutBankAccountNumber: true,
          payoutBankUpdatedAt: true,
          payoutBankChangeEffectiveAt: true,
          revenueWallet: {
            select: {
              pendingIdr: true,
              availableIdr: true,
              reservedIdr: true,
              lifetimeIdr: true,
            },
          },
        },
      });

      const totals = bases.reduce(
        (acc, base) => {
          acc.pendingIdr += base.revenueWallet?.pendingIdr ?? 0;
          acc.availableIdr += base.revenueWallet?.availableIdr ?? 0;
          acc.reservedIdr += base.revenueWallet?.reservedIdr ?? 0;
          acc.lifetimeIdr += base.revenueWallet?.lifetimeIdr ?? 0;
          return acc;
        },
        { pendingIdr: 0, availableIdr: 0, reservedIdr: 0, lifetimeIdr: 0 }
      );

      return {
        scope: 'all',
        enabled: ENV.BASE_PAYOUTS_ENABLED,
        currency: 'IDR',
        min_payout_idr: BASE_PAYOUT_MIN_IDR,
        payout_fee_idr: ENV.BASE_PAYOUT_FEE_IDR,
        revenue_per_fess_idr: BASE_REVENUE_PER_FESS_IDR,
        hold_days: BASE_REVENUE_HOLD_DAYS,
        totals: {
          pending_idr: totals.pendingIdr,
          available_idr: totals.availableIdr,
          reserved_idr: totals.reservedIdr,
          lifetime_idr: totals.lifetimeIdr,
        },
        bases: bases.map((base) => ({
          ...this.serializeBase(base, { revealBank: true }),
          pending_idr: base.revenueWallet?.pendingIdr ?? 0,
          available_idr: base.revenueWallet?.availableIdr ?? 0,
          reserved_idr: base.revenueWallet?.reservedIdr ?? 0,
          lifetime_idr: base.revenueWallet?.lifetimeIdr ?? 0,
        })),
      };
    }

    const base = await this.resolveBase(currentUser, baseHandle);
    if (!base) fail(404, 'BASE_NOT_FOUND', 'Base tidak ditemukan');

    await this.releaseMatured(base.id);

    const [wallet, entries, payouts, freshBase] = await Promise.all([
      prisma.baseRevenueWallet.findUnique({
        where: { baseId: base.id },
        select: {
          pendingIdr: true,
          availableIdr: true,
          reservedIdr: true,
          lifetimeIdr: true,
        },
      }),
      prisma.baseRevenueEntry.findMany({
        where: { baseId: base.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          fessId: true,
          type: true,
          amountIdr: true,
          status: true,
          availableAt: true,
          reversedAt: true,
          reversalReason: true,
          createdAt: true,
        },
      }),
      prisma.basePayout.findMany({
        where: { baseId: base.id },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: {
          base: { select: { handle: true, name: true } },
          requestedBy: { select: { handle: true } },
          reviewedBy: { select: { handle: true } },
        },
      }),
      prisma.base.findUniqueOrThrow({ where: { id: base.id } }),
    ]);

    return {
      scope: 'base',
      enabled: ENV.BASE_PAYOUTS_ENABLED,
      currency: 'IDR',
      min_payout_idr: BASE_PAYOUT_MIN_IDR,
      payout_fee_idr: ENV.BASE_PAYOUT_FEE_IDR,
      revenue_per_fess_idr: BASE_REVENUE_PER_FESS_IDR,
      hold_days: BASE_REVENUE_HOLD_DAYS,
      base: this.serializeBase(freshBase, {
        revealBank: currentUser.role === 'Super Admin',
      }),
      wallet: {
        pending_idr: wallet?.pendingIdr ?? 0,
        available_idr: wallet?.availableIdr ?? 0,
        reserved_idr: wallet?.reservedIdr ?? 0,
        lifetime_idr: wallet?.lifetimeIdr ?? 0,
      },
      entries: entries.map((entry) => ({
        id: entry.id,
        fess_id: entry.fessId,
        type: String(entry.type).toLowerCase(),
        amount_idr: entry.amountIdr,
        status: String(entry.status).toLowerCase(),
        available_at: asIso(entry.availableAt),
        reversed_at: asIso(entry.reversedAt),
        reversal_reason: entry.reversalReason ?? null,
        created_at: asIso(entry.createdAt),
      })),
      payouts: payouts.map((payout) =>
        this.serializePayout(payout, currentUser.role === 'Super Admin')
      ),
    };
  }

  static async listPayouts(
    currentUser: RevenueCurrentUser,
    options: {
      status?: string;
      baseHandle?: string;
      q?: string;
      page?: number;
      limit?: number;
    } = {}
  ) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
    const status = options.status?.toUpperCase();
    const baseHandle = options.baseHandle ? normalizeHandle(options.baseHandle) : undefined;
    const search = String(options.q || '').trim();

    const and: Prisma.BasePayoutWhereInput[] = [];
    if (status) and.push({ status: status as any });
    if (baseHandle) and.push({ base: { handle: baseHandle } });
    if (search) {
      and.push({
        OR: [
          { reference: { contains: search, mode: 'insensitive' } },
          { requestKey: { contains: search, mode: 'insensitive' } },
          { base: { handle: { contains: search, mode: 'insensitive' } } },
          { base: { name: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }
    if (currentUser.role !== 'Super Admin') {
      and.push({
        base: {
          OR: [
            { creatorId: currentUser.id },
            ...((currentUser.managedBases || []).length > 0
              ? [{ handle: { in: currentUser.managedBases } }]
              : []),
          ],
        },
      });
    }

    const where: Prisma.BasePayoutWhereInput = and.length ? { AND: and } : {};

    const [total, payouts] = await Promise.all([
      prisma.basePayout.count({ where }),
      prisma.basePayout.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          base: { select: { handle: true, name: true } },
          requestedBy: { select: { handle: true } },
          reviewedBy: { select: { handle: true } },
        },
      }),
    ]);

    return {
      data: payouts.map((payout) =>
        this.serializePayout(payout, currentUser.role === 'Super Admin')
      ),
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    };
  }

  static async requestPayout(
    currentUser: RevenueCurrentUser,
    input: {
      amountIdr: number;
      baseHandle?: string | null;
      requestKey: string;
      notes?: string | null;
    },
    meta: RequestMeta = {}
  ) {
    if (currentUser.role === 'Super Admin') {
      fail(
        403,
        'BASE_ADMIN_ONLY',
        'Pengajuan payout adalah aksi Base Admin. Super Admin hanya meninjau payout.'
      );
    }
    if (!ENV.BASE_PAYOUTS_ENABLED) {
      fail(503, 'PAYOUTS_DISABLED', 'Payout base sedang dinonaktifkan');
    }

    const requestKey = String(input.requestKey || '').trim();
    if (!requestKey || requestKey.length > 180) {
      fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Header Idempotency-Key wajib dikirim');
    }
    assertAmount(input.amountIdr);

    const existing = await prisma.basePayout.findUnique({
      where: { requestKey },
      include: {
        base: { select: { handle: true, name: true } },
        requestedBy: { select: { handle: true } },
        reviewedBy: { select: { handle: true } },
      },
    });
    if (existing) {
      if (
        existing.requestedById !== currentUser.id ||
        existing.amountIdr !== input.amountIdr
      ) {
        fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key sudah dipakai untuk payout lain');
      }
      if (
        input.baseHandle &&
        existing.base?.handle &&
        existing.base.handle !== normalizeHandle(input.baseHandle)
      ) {
        fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key sudah dipakai untuk base lain');
      }
      return { payout: this.serializePayout(existing, currentUser.role === 'Super Admin'), idempotent: true };
    }

    if (currentUser.role === 'Super Admin' && !input.baseHandle) {
      fail(400, 'BASE_HANDLE_REQUIRED', 'Super Admin wajib memilih base untuk payout');
    }

    const base = await this.resolveBase(currentUser, input.baseHandle);
    if (!base) fail(404, 'BASE_NOT_FOUND', 'Base tidak ditemukan');
    if (base.payoutKycStatus !== 'verified') {
      fail(403, 'PAYOUT_KYC_REQUIRED', 'KYC base harus diverifikasi Super Admin sebelum payout');
    }
    if (
      !base.payoutBankName ||
      !base.payoutBankAccountName ||
      !base.payoutBankAccountNumber
    ) {
      fail(400, 'PAYOUT_BANK_REQUIRED', 'Lengkapi rekening bank sebelum mengajukan payout');
    }
    if (
      base.payoutBankChangeEffectiveAt &&
      new Date(base.payoutBankChangeEffectiveAt).getTime() > Date.now()
    ) {
      fail(
        403,
        'PAYOUT_BANK_CHANGE_PENDING',
        'Perubahan rekening masih dalam masa tunggu 24 jam'
      );
    }

    await this.releaseMatured(base.id);

    const wallet = await prisma.baseRevenueWallet.findUnique({
      where: { baseId: base.id },
      select: { id: true, availableIdr: true, reservedIdr: true },
    });
    if (!wallet || wallet.availableIdr < input.amountIdr) {
      fail(402, 'PAYOUT_INSUFFICIENT', 'Saldo revenue available tidak mencukupi');
    }

    try {
      const payout = await prisma.$transaction(async (tx) => {
        const reserved = await tx.baseRevenueWallet.updateMany({
          where: { id: wallet.id, availableIdr: { gte: input.amountIdr } },
          data: {
            availableIdr: { decrement: input.amountIdr },
            reservedIdr: { increment: input.amountIdr },
          },
        });
        if (reserved.count !== 1) {
          fail(402, 'PAYOUT_INSUFFICIENT', 'Saldo revenue available tidak mencukupi');
        }

        const created = await tx.basePayout.create({
          data: {
            baseId: base.id,
            walletId: wallet.id,
            requestedById: currentUser.id,
            amountIdr: input.amountIdr,
            feeIdr: 0,
            netIdr: input.amountIdr,
            status: 'REQUESTED',
            bankName: base.payoutBankName!,
            bankAccountName: base.payoutBankAccountName!,
            bankAccountNumber: base.payoutBankAccountNumber!,
            requestKey,
            notes: input.notes?.trim() || null,
          },
          include: {
            base: { select: { handle: true, name: true } },
            requestedBy: { select: { handle: true } },
          },
        });

        await AdminSecurityService.writeAudit(
          {
            actorId: currentUser.id,
            action: 'BASE_PAYOUT_REQUESTED',
            targetType: 'BasePayout',
            targetId: created.id,
            reason: input.notes?.trim() || null,
            metadata: {
              base_handle: base.handle,
              amount_idr: input.amountIdr,
              status: 'REQUESTED',
            },
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
          },
          tx
        );

        return created;
      });

      return {
        payout: this.serializePayout(payout, currentUser.role === 'Super Admin'),
        idempotent: false,
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const winner = await prisma.basePayout.findUnique({
          where: { requestKey },
          include: {
            base: { select: { handle: true, name: true } },
            requestedBy: { select: { handle: true } },
            reviewedBy: { select: { handle: true } },
          },
        });
        if (winner && winner.requestedById === currentUser.id) {
          return {
            payout: this.serializePayout(winner, currentUser.role === 'Super Admin'),
            idempotent: true,
          };
        }
      }
      throw error;
    }
  }

  static async reviewPayout(
    currentUser: RevenueCurrentUser,
    payoutId: string,
    action: 'approve' | 'reject' | 'mark_paid' | 'mark_failed',
    input: {
      password?: string | null;
      reason?: string | null;
      feeIdr?: number;
      reference?: string | null;
    },
    meta: RequestMeta = {}
  ) {
    if (!ENV.BASE_PAYOUTS_ENABLED) {
      fail(503, 'PAYOUTS_DISABLED', 'Payout base sedang dinonaktifkan');
    }
    if (currentUser.role !== 'Super Admin') {
      fail(403, 'FORBIDDEN', 'Hanya Super Admin yang dapat meninjau payout');
    }

    const payout = await prisma.basePayout.findUnique({
      where: { id: payoutId },
      include: {
        base: { select: { id: true, handle: true, name: true } },
        requestedBy: { select: { handle: true } },
        reviewedBy: { select: { handle: true } },
      },
    });
    if (!payout) fail(404, 'PAYOUT_NOT_FOUND', 'Payout tidak ditemukan');
    if (payout.requestedById === currentUser.id) {
      fail(403, 'PAYOUT_SELF_APPROVAL', 'Pengaju payout tidak boleh menyetujui payout sendiri');
    }

    // Every review action changes money or releases a reservation, so every
    // action requires a fresh password proof and writes an audit row.
    await AdminSecurityService.assertReauth(currentUser.id, input.password);

    let feeIdr = payout.feeIdr;
    let reference = payout.reference;

    if (action === 'approve') {
      if (payout.status !== 'REQUESTED') {
        fail(409, 'PAYOUT_STATUS_CONFLICT', 'Payout tidak berada pada status REQUESTED');
      }
      feeIdr = input.feeIdr ?? ENV.BASE_PAYOUT_FEE_IDR;
      if (!Number.isSafeInteger(feeIdr) || feeIdr < 0 || feeIdr >= payout.amountIdr) {
        fail(422, 'PAYOUT_FEE_INVALID', 'Biaya transfer tidak valid');
      }
    } else if (action === 'mark_paid') {
      if (payout.status !== 'APPROVED') {
        fail(409, 'PAYOUT_STATUS_CONFLICT', 'Payout belum disetujui');
      }
      reference = String(input.reference || '').trim();
      if (!reference) {
        fail(422, 'PAYOUT_REFERENCE_REQUIRED', 'Referensi transfer wajib diisi');
      }
    } else if (action === 'reject') {
      if (!['REQUESTED', 'APPROVED'].includes(payout.status)) {
        fail(409, 'PAYOUT_STATUS_CONFLICT', 'Payout tidak dapat ditolak pada status ini');
      }
      if (!String(input.reason || '').trim()) {
        fail(422, 'PAYOUT_REASON_REQUIRED', 'Alasan penolakan wajib diisi');
      }
    } else if (action === 'mark_failed') {
      if (payout.status !== 'APPROVED') {
        fail(409, 'PAYOUT_STATUS_CONFLICT', 'Hanya payout APPROVED yang dapat ditandai gagal');
      }
      if (!String(input.reason || '').trim()) {
        fail(422, 'PAYOUT_REASON_REQUIRED', 'Alasan kegagalan transfer wajib diisi');
      }
    }

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      let changed = 0;

      if (action === 'approve') {
        const updated = await tx.basePayout.updateMany({
          where: { id: payout.id, status: 'REQUESTED' },
          data: {
            status: 'APPROVED',
            reviewedById: currentUser.id,
            reviewedAt: now,
            feeIdr,
            netIdr: payout.amountIdr - feeIdr,
          },
        });
        changed = updated.count;
      } else if (action === 'mark_paid') {
        const updated = await tx.basePayout.updateMany({
          where: { id: payout.id, status: 'APPROVED' },
          data: {
            status: 'PAID',
            paidAt: now,
            reference,
            reviewedById: currentUser.id,
            reviewedAt: payout.reviewedAt ?? now,
          },
        });
        changed = updated.count;
        if (changed === 1) {
          await tx.baseRevenueWallet.update({
            where: { id: payout.walletId },
            data: { reservedIdr: { decrement: payout.amountIdr } },
          });
        }
      } else if (action === 'reject') {
        const updated = await tx.basePayout.updateMany({
          where: { id: payout.id, status: { in: ['REQUESTED', 'APPROVED'] } },
          data: {
            status: 'REJECTED',
            reviewedById: currentUser.id,
            reviewedAt: now,
            rejectionReason: String(input.reason).trim(),
          },
        });
        changed = updated.count;
        if (changed === 1) {
          await tx.baseRevenueWallet.update({
            where: { id: payout.walletId },
            data: {
              availableIdr: { increment: payout.amountIdr },
              reservedIdr: { decrement: payout.amountIdr },
            },
          });
        }
      } else {
        const updated = await tx.basePayout.updateMany({
          where: { id: payout.id, status: 'APPROVED' },
          data: {
            status: 'FAILED',
            reviewedById: currentUser.id,
            reviewedAt: now,
            failedAt: now,
            rejectionReason: String(input.reason).trim(),
          },
        });
        changed = updated.count;
        if (changed === 1) {
          await tx.baseRevenueWallet.update({
            where: { id: payout.walletId },
            data: {
              availableIdr: { increment: payout.amountIdr },
              reservedIdr: { decrement: payout.amountIdr },
            },
          });
        }
      }

      if (changed !== 1) {
        fail(409, 'PAYOUT_STATUS_CONFLICT', 'Status payout sudah berubah. Muat ulang data.');
      }

      await AdminSecurityService.writeAudit(
        {
          actorId: currentUser.id,
          action: `BASE_PAYOUT_${action.toUpperCase()}`,
          targetType: 'BasePayout',
          targetId: payout.id,
          reason: input.reason?.trim() || null,
          metadata: {
            base_handle: payout.base.handle,
            status: action.toUpperCase(),
            amount_idr: payout.amountIdr,
            fee_idr: feeIdr,
            net_idr: payout.amountIdr - feeIdr,
            reference: reference || null,
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        tx
      );

      return tx.basePayout.findUniqueOrThrow({
        where: { id: payout.id },
        include: {
          base: { select: { handle: true, name: true } },
          requestedBy: { select: { handle: true } },
          reviewedBy: { select: { handle: true } },
        },
      });
    });

    return this.serializePayout(result, true);
  }

  static async updateBank(
    currentUser: RevenueCurrentUser,
    input: {
      baseHandle?: string | null;
      bankName: string;
      bankAccountName: string;
      bankAccountNumber: string;
      password?: string | null;
    },
    meta: RequestMeta = {}
  ) {
    if (currentUser.role === 'Super Admin') {
      fail(
        403,
        'BASE_ADMIN_ONLY',
        'Perubahan rekening adalah aksi Base Admin. Super Admin hanya dapat melihat data rekening untuk dukungan.'
      );
    }
    await AdminSecurityService.assertReauth(currentUser.id, input.password);
    const base = await this.resolveBase(currentUser, input.baseHandle);
    if (!base) fail(404, 'BASE_NOT_FOUND', 'Base tidak ditemukan');

    const bankName = input.bankName.trim();
    const bankAccountName = input.bankAccountName.trim();
    const bankAccountNumber = input.bankAccountNumber.replace(/\s+/g, '');
    if (!bankName || !bankAccountName || !/^\d{5,34}$/.test(bankAccountNumber)) {
      fail(422, 'PAYOUT_BANK_INVALID', 'Data rekening bank tidak valid');
    }

    const firstTime = !base.payoutBankAccountNumber;
    const unchanged =
      base.payoutBankName === bankName &&
      base.payoutBankAccountName === bankAccountName &&
      base.payoutBankAccountNumber === bankAccountNumber;
    if (unchanged) {
      return this.serializeBase(base, { revealBank: true });
    }

    const now = new Date();
    const effectiveAt = firstTime
      ? now
      : new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.base.update({
        where: { id: base.id },
        data: {
          payoutBankName: bankName,
          payoutBankAccountName: bankAccountName,
          payoutBankAccountNumber: bankAccountNumber,
          payoutBankUpdatedAt: now,
          payoutBankChangeEffectiveAt: effectiveAt,
        },
      });

      await AdminSecurityService.writeAudit(
        {
          actorId: currentUser.id,
          action: 'BASE_BANK_DETAILS_UPDATED',
          targetType: 'Base',
          targetId: base.id,
          reason: firstTime ? 'Rekening pertama kali diatur' : 'Perubahan rekening bank',
          metadata: {
            base_handle: base.handle,
            bank_name: bankName,
            account_masked: maskAccountNumber(bankAccountNumber),
            effective_at: effectiveAt.toISOString(),
            first_time: firstTime,
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        tx
      );

      return saved;
    });

    return this.serializeBase(updated, { revealBank: true });
  }

  static async setKyc(
    currentUser: RevenueCurrentUser,
    input: {
      baseHandle: string;
      status: 'verified' | 'rejected' | 'unverified';
      note?: string | null;
      password?: string | null;
    },
    meta: RequestMeta = {}
  ) {
    if (currentUser.role !== 'Super Admin') {
      fail(403, 'FORBIDDEN', 'Hanya Super Admin yang dapat memverifikasi KYC');
    }
    await AdminSecurityService.assertReauth(currentUser.id, input.password);

    const base = await prisma.base.findUnique({
      where: { handle: normalizeHandle(input.baseHandle) },
    });
    if (!base) fail(404, 'BASE_NOT_FOUND', 'Base tidak ditemukan');

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.base.update({
        where: { id: base.id },
        data: {
          payoutKycStatus: input.status,
          payoutKycVerifiedAt: input.status === 'verified' ? now : null,
          payoutKycNote: input.note?.trim() || null,
        },
      });

      await AdminSecurityService.writeAudit(
        {
          actorId: currentUser.id,
          action: 'BASE_PAYOUT_KYC_UPDATED',
          targetType: 'Base',
          targetId: base.id,
          reason: input.note?.trim() || null,
          metadata: {
            base_handle: base.handle,
            previous_status: base.payoutKycStatus,
            new_status: input.status,
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        tx
      );

      return saved;
    });

    if (input.status === 'verified') {
      await AdminSecurityService.writeAlert(
        'PAYOUT',
        `KYC payout base ${base.handle} diverifikasi oleh ${currentUser.id}.`,
        'info'
      );
    }

    return this.serializeBase(updated, { revealBank: true });
  }

  static async setFreeForever(
    currentUser: RevenueCurrentUser,
    input: {
      baseHandle: string;
      freeForever: boolean;
      reason: string;
      password?: string | null;
    },
    meta: RequestMeta = {}
  ) {
    if (currentUser.role !== 'Super Admin') {
      fail(403, 'FORBIDDEN', 'Hanya Super Admin yang dapat mengubah freeForever');
    }
    await AdminSecurityService.assertReauth(currentUser.id, input.password);

    const reason = String(input.reason || '').trim();
    if (reason.length < 5) {
      fail(422, 'REASON_REQUIRED', 'Alasan perubahan freeForever wajib diisi minimal 5 karakter');
    }

    const base = await prisma.base.findUnique({
      where: { handle: normalizeHandle(input.baseHandle) },
    });
    if (!base) fail(404, 'BASE_NOT_FOUND', 'Base tidak ditemukan');

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.base.update({
        where: { id: base.id },
        data: {
          freeForever: input.freeForever,
          freeForeverReason: reason,
          freeForeverSetById: currentUser.id,
          freeForeverSetAt: now,
        },
      });

      await AdminSecurityService.writeAudit(
        {
          actorId: currentUser.id,
          action: 'BASE_FREE_FOREVER_UPDATED',
          targetType: 'Base',
          targetId: base.id,
          reason,
          metadata: {
            base_handle: base.handle,
            previous_value: base.freeForever,
            new_value: input.freeForever,
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        tx
      );

      return saved;
    });

    await AdminSecurityService.writeAlert(
      'PAYOUT',
      `Super Admin ${currentUser.id} mengubah freeForever base ${base.handle} menjadi ${input.freeForever}. Alasan: ${reason}`,
      'error'
    );

    return this.serializeBase(updated, { revealBank: true });
  }
}
