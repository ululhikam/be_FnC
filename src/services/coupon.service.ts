import { Prisma } from '@prisma/client';
import type { CouponDiscountType } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import {
  MIN_CHARGEABLE_IDR,
  normalizeCouponCode,
  type PaymentPackage,
} from '../constants/payments.js';
import {
  quoteCoupon,
  type CouponQuote,
  type CouponRule,
} from '../utils/coupon.util.js';
import { AdminSecurityService } from './admin-security.service.js';
import { PaymentPackageService } from './payment-package.service.js';

/**
 * Kupon promo top-up CTF.
 * ---------------------------------------------------------------------------
 * - Hanya Super Admin yang boleh menulis (re-auth + alasan + audit).
 * - Diskon mengurangi harga bayar, TIDAK mengurangi CTF yang diterima.
 * - Pemakaian dikunci saat order dibuat (RESERVED) lalu dikonfirmasi saat
 *   lunas, sehingga kuota tidak bisa dilampaui oleh banyak order pending.
 * - Kuota dilepas hanya saat order FAILED. Order EXPIRED tetap memegang kuota
 *   karena Midtrans masih boleh melunasi order tersebut (PENDING/EXPIRED → PAID).
 */

type DbClient = Prisma.TransactionClient | typeof prisma;

export type CouponActor = { id: string; role?: string | null };
export type RequestMeta = { ipAddress?: string | null; userAgent?: string | null };

export type CouponInput = {
  label?: string | null;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscountIdr?: number | null;
  minAmountIdr?: number;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  maxRedemptions?: number | null;
  isActive?: boolean;
  reason: string;
  password?: string | null;
};

export type CreateCouponInput = CouponInput & { code: string };

type Row = {
  code: string;
  label: string;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscountIdr: number | null;
  minAmountIdr: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  maxPerUser: number;
  isActive: boolean;
  createdById: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const select = {
  code: true,
  label: true,
  discountType: true,
  discountValue: true,
  maxDiscountIdr: true,
  minAmountIdr: true,
  startsAt: true,
  endsAt: true,
  maxRedemptions: true,
  redemptionCount: true,
  maxPerUser: true,
  isActive: true,
  createdById: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
} as const;

const MAX_DISCOUNT_IDR = 10_000_000;

function fail(status: number, code: string, message: string): never {
  const error: any = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

/** Tabel belum ada karena migrasi belum dijalankan. */
function isMissingTable(error: unknown) {
  return (error as any)?.code === 'P2021';
}

function asIso(value: Date | null | undefined) {
  return value instanceof Date ? value.toISOString() : null;
}

function parseDate(value: Date | string | null | undefined, label: string): Date | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    fail(422, 'INVALID_COUPON_DATE', `${label} tidak valid`);
  }
  return date;
}

function toRule(row: Row): CouponRule {
  return {
    code: row.code,
    label: row.label,
    discountType: row.discountType,
    discountValue: row.discountValue,
    maxDiscountIdr: row.maxDiscountIdr,
    minAmountIdr: row.minAmountIdr,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    maxRedemptions: row.maxRedemptions,
    redemptionCount: row.redemptionCount,
    maxPerUser: row.maxPerUser,
    isActive: row.isActive,
  };
}

function toView(row: Row, confirmedCount = 0) {
  return {
    code: row.code,
    label: row.label,
    discount_type: row.discountType,
    discount_value: row.discountValue,
    max_discount_idr: row.maxDiscountIdr,
    min_amount_idr: row.minAmountIdr,
    starts_at: asIso(row.startsAt),
    ends_at: asIso(row.endsAt),
    max_redemptions: row.maxRedemptions,
    redemption_count: row.redemptionCount,
    confirmed_count: confirmedCount,
    max_per_user: row.maxPerUser,
    is_active: row.isActive,
    created_at: asIso(row.createdAt),
    updated_at: asIso(row.updatedAt),
    updated_by_id: row.updatedById,
  };
}

/** Alasan wajib diisi: kupon mengubah uang yang ditagih. */
function assertReason(reason: string | null | undefined, label: string) {
  const clean = String(reason ?? '').trim();
  if (clean.length < 5) {
    fail(422, 'REASON_REQUIRED', `Alasan ${label} wajib diisi minimal 5 karakter`);
  }
  return clean;
}

function normalizeRuleInput(input: CouponInput) {
  if (input.discountType !== 'FIXED' && input.discountType !== 'PERCENT') {
    fail(422, 'INVALID_DISCOUNT_TYPE', 'Tipe diskon harus FIXED atau PERCENT');
  }

  const discountValue = Math.trunc(Number(input.discountValue));
  if (!Number.isInteger(discountValue) || discountValue <= 0) {
    fail(422, 'INVALID_DISCOUNT_VALUE', 'Nilai diskon harus bilangan bulat lebih dari 0');
  }
  if (input.discountType === 'PERCENT' && discountValue > 100) {
    fail(422, 'INVALID_DISCOUNT_VALUE', 'Diskon persen maksimal 100');
  }
  if (input.discountType === 'FIXED' && discountValue > MAX_DISCOUNT_IDR) {
    fail(422, 'INVALID_DISCOUNT_VALUE', 'Diskon nominal maksimal Rp10.000.000');
  }

  const maxDiscountIdr =
    input.discountType === 'PERCENT' && input.maxDiscountIdr != null
      ? Math.trunc(Number(input.maxDiscountIdr))
      : null;
  if (maxDiscountIdr != null && (!Number.isInteger(maxDiscountIdr) || maxDiscountIdr <= 0)) {
    fail(422, 'INVALID_DISCOUNT_VALUE', 'Batas potongan harus lebih dari 0');
  }

  const minAmountIdr =
    input.minAmountIdr == null ? 0 : Math.trunc(Number(input.minAmountIdr));
  if (!Number.isInteger(minAmountIdr) || minAmountIdr < 0 || minAmountIdr > MAX_DISCOUNT_IDR) {
    fail(422, 'INVALID_MIN_AMOUNT', 'Minimum pembelian harus 0 - Rp10.000.000');
  }

  const maxRedemptions =
    input.maxRedemptions == null ? null : Math.trunc(Number(input.maxRedemptions));
  if (maxRedemptions != null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) {
    fail(422, 'INVALID_QUOTA', 'Kuota kupon minimal 1 atau kosongkan untuk tanpa batas');
  }

  const startsAt = parseDate(input.startsAt, 'Tanggal mulai');
  const endsAt = parseDate(input.endsAt, 'Tanggal berakhir');
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    fail(422, 'INVALID_COUPON_DATE', 'Tanggal berakhir harus setelah tanggal mulai');
  }

  return {
    label: String(input.label ?? '').trim().slice(0, 60),
    discountValue,
    maxDiscountIdr,
    minAmountIdr,
    startsAt,
    endsAt,
    maxRedemptions,
  };
}

/** Terjemahkan penolakan kupon menjadi error HTTP. */
function quoteError(quote: Extract<CouponQuote, { ok: false }>): never {
  if (quote.reason === 'COUPON_NOT_FOUND') fail(404, quote.reason, quote.message);
  if (quote.reason === 'COUPON_QUOTA_EXHAUSTED' || quote.reason === 'COUPON_ALREADY_USED') {
    fail(409, quote.reason, quote.message);
  }
  return fail(422, quote.reason, quote.message);
}

export class CouponService {
  /** Pratinjau potongan sebelum order dibuat (tanpa mengunci kuota). */
  static async preview(
    user: { id: string },
    input: { code: string; packageCode: string }
  ): Promise<{
    code: string;
    label: string;
    discount_type: CouponDiscountType;
    discount_value: number;
    discount_idr: number;
    amount_idr: number;
    final_amount_idr: number;
    ctf_amount: number;
    package: PaymentPackage;
  }> {
    const pkg = await PaymentPackageService.findForOrder(input.packageCode);
    if (!pkg) fail(400, 'UNKNOWN_PACKAGE', 'Paket top-up tidak ditemukan');

    const code = normalizeCouponCode(input.code);
    if (!code) fail(422, 'INVALID_COUPON_CODE', 'Format kode kupon tidak valid');

    const row = await this.findRow(code);
    const userRedemptions = await prisma.couponRedemption.count({
      where: { couponCode: code, userId: user.id, status: { in: ['RESERVED', 'CONFIRMED'] } },
    });

    const quote = quoteCoupon({ coupon: row ? toRule(row) : null, amountIdr: pkg.amountIdr, userRedemptions });
    if (!quote.ok) quoteError(quote);

    return {
      code: quote.code,
      label: quote.label,
      discount_type: quote.discountType,
      discount_value: quote.discountValue,
      discount_idr: quote.discountIdr,
      amount_idr: quote.amountIdr,
      final_amount_idr: quote.finalAmountIdr,
      ctf_amount: pkg.ctfAmount,
      package: pkg,
    };
  }

  /**
   * Kunci kuota kupon di dalam transaksi pembuatan order.
   * Urutannya penting: increment kuota (mengunci baris Coupon) lebih dulu,
   * baru hitung pemakaian user, supaya dua order bersamaan dari user yang sama
   * tidak bisa sama-sama lolos.
   */
  static async reserve(
    tx: Prisma.TransactionClient,
    input: { code: string; userId: string; orderId: string; amountIdr: number }
  ) {
    const code = normalizeCouponCode(input.code);
    if (!code) fail(422, 'INVALID_COUPON_CODE', 'Format kode kupon tidak valid');

    const row = await tx.coupon.findUnique({ where: { code }, select });
    const quote = quoteCoupon({ coupon: row ? toRule(row) : null, amountIdr: input.amountIdr, userRedemptions: 0 });
    if (!quote.ok) quoteError(quote);

    const claimed = await tx.coupon.updateMany({
      where: {
        code,
        isActive: true,
        ...(row?.maxRedemptions != null
          ? { redemptionCount: { lt: row.maxRedemptions } }
          : {}),
      },
      data: { redemptionCount: { increment: 1 } },
    });
    if (claimed.count === 0) {
      fail(409, 'COUPON_QUOTA_EXHAUSTED', 'Kuota kupon sudah habis');
    }

    // Baris Coupon kini terkunci oleh transaksi ini, jadi hitungan pemakaian
    // user sudah final relatif terhadap order lain untuk kupon yang sama.
    const used = await tx.couponRedemption.count({
      where: { couponCode: code, userId: input.userId, status: { in: ['RESERVED', 'CONFIRMED'] } },
    });
    if (row && row.maxPerUser > 0 && used >= row.maxPerUser) {
      fail(
        409,
        'COUPON_ALREADY_USED',
        row.maxPerUser === 1
          ? 'Kupon ini hanya bisa dipakai satu kali per akun'
          : `Kupon ini maksimal dipakai ${row.maxPerUser} kali per akun`
      );
    }

    await tx.couponRedemption.create({
      data: {
        couponCode: code,
        userId: input.userId,
        orderId: input.orderId,
        status: 'RESERVED',
        amountIdr: input.amountIdr,
        discountIdr: quote.discountIdr,
      },
    });

    return {
      code,
      discountIdr: quote.discountIdr,
      finalAmountIdr: quote.finalAmountIdr,
    };
  }

  /** Tandai kupon terpakai setelah order lunas. */
  static async confirm(tx: DbClient, orderId: string) {
    const updated = await tx.couponRedemption.updateMany({
      where: { orderId, status: 'RESERVED' },
      data: { status: 'CONFIRMED', paidAt: new Date() },
    });
    return updated.count > 0;
  }

  /** Kembalikan kuota saat order gagal. Order EXPIRED sengaja tidak dilepas. */
  static async release(tx: DbClient, orderId: string) {
    const found = await tx.couponRedemption.findUnique({
      where: { orderId },
      select: { couponCode: true, status: true },
    });
    if (!found || found.status !== 'RESERVED') return false;

    const updated = await tx.couponRedemption.updateMany({
      where: { orderId, status: 'RESERVED' },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
    if (updated.count === 0) return false;

    await tx.coupon.updateMany({
      where: { code: found.couponCode, redemptionCount: { gt: 0 } },
      data: { redemptionCount: { decrement: 1 } },
    });
    return true;
  }

  /** Daftar kupon untuk konsol Super Admin (termasuk yang nonaktif). */
  static async listForAdmin() {
    let rows: Array<Row & { _count?: { redemptions: number } }>;
    try {
      rows = await prisma.coupon.findMany({
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        select: { ...select, _count: { select: { redemptions: true } } },
      });
    } catch (error) {
      if (!isMissingTable(error)) throw error;
      return { source: 'fallback' as const, coupons: [] };
    }

    const confirmed = await prisma.couponRedemption.groupBy({
      by: ['couponCode'],
      where: { status: 'CONFIRMED' },
      _count: { _all: true },
    });
    const confirmedByCode = new Map(
      confirmed.map((row) => [row.couponCode, row._count._all] as const)
    );

    return {
      source: 'database' as const,
      coupons: rows.map((row) => toView(row, confirmedByCode.get(row.code) ?? 0)),
    };
  }

  static async create(currentUser: CouponActor, input: CreateCouponInput, meta: RequestMeta = {}) {
    this.assertSuperAdmin(currentUser);
    await AdminSecurityService.assertReauth(currentUser.id, input.password);
    const reason = assertReason(input.reason, 'pembuatan kupon');
    const code = normalizeCouponCode(input.code);
    if (!code) {
      fail(
        422,
        'INVALID_COUPON_CODE',
        'Kode kupon 3-32 karakter: huruf, angka, garis bawah, atau strip'
      );
    }
    const rule = normalizeRuleInput(input);

    const existing = await prisma.coupon
      .findUnique({ where: { code }, select: { code: true } })
      .catch((error) => {
        if (isMissingTable(error)) this.failMissingTable();
        throw error;
      });
    if (existing) fail(409, 'COUPON_CODE_TAKEN', `Kode kupon "${code}" sudah dipakai`);

    const saved = await prisma.coupon
      .create({
        data: {
          code,
          ...rule,
          discountType: input.discountType,
          maxPerUser: 1,
          isActive: input.isActive ?? true,
          createdById: currentUser.id,
          updatedById: currentUser.id,
        },
        select,
      })
      .catch((error) => {
        if ((error as any)?.code === 'P2002') {
          fail(409, 'COUPON_CODE_TAKEN', `Kode kupon "${code}" sudah dipakai`);
        }
        throw error;
      });

    await AdminSecurityService.writeAudit({
      actorId: currentUser.id,
      action: 'COUPON_CREATED',
      targetType: 'Coupon',
      targetId: code,
      reason,
      metadata: {
        code,
        discount_type: saved.discountType,
        discount_value: saved.discountValue,
        max_discount_idr: saved.maxDiscountIdr,
        min_amount_idr: saved.minAmountIdr,
        max_redemptions: saved.maxRedemptions,
        is_active: saved.isActive,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await AdminSecurityService.writeAlert(
      'PAYOUT',
      `Super Admin ${currentUser.id} membuat kupon ${code} (${this.describeDiscount(saved)}). Alasan: ${reason}`,
      'info'
    );

    return toView(saved);
  }

  static async update(
    currentUser: CouponActor,
    code: string,
    input: CouponInput,
    meta: RequestMeta = {}
  ) {
    this.assertSuperAdmin(currentUser);
    await AdminSecurityService.assertReauth(currentUser.id, input.password);
    const reason = assertReason(input.reason, 'perubahan kupon');
    const cleanCode = normalizeCouponCode(code);
    const rule = normalizeRuleInput(input);

    const previous = await this.findRow(cleanCode);
    if (!previous) fail(404, 'COUPON_NOT_FOUND', 'Kupon tidak ditemukan');

    if (
      previous.maxRedemptions != null &&
      rule.maxRedemptions != null &&
      rule.maxRedemptions < previous.redemptionCount
    ) {
      fail(
        422,
        'COUPON_QUOTA_BELOW_USAGE',
        `Kuota tidak boleh lebih kecil dari pemakaian saat ini (${previous.redemptionCount})`
      );
    }

    const saved = await prisma.coupon.update({
      where: { code: cleanCode },
      data: {
        ...rule,
        discountType: input.discountType,
        isActive: input.isActive ?? previous.isActive,
        updatedById: currentUser.id,
      },
      select,
    });

    await AdminSecurityService.writeAudit({
      actorId: currentUser.id,
      action: 'COUPON_UPDATED',
      targetType: 'Coupon',
      targetId: cleanCode,
      reason,
      metadata: {
        code: cleanCode,
        previous: {
          discount_type: previous.discountType,
          discount_value: previous.discountValue,
          max_discount_idr: previous.maxDiscountIdr,
          min_amount_idr: previous.minAmountIdr,
          starts_at: asIso(previous.startsAt),
          ends_at: asIso(previous.endsAt),
          max_redemptions: previous.maxRedemptions,
          is_active: previous.isActive,
        },
        next: {
          discount_type: saved.discountType,
          discount_value: saved.discountValue,
          max_discount_idr: saved.maxDiscountIdr,
          min_amount_idr: saved.minAmountIdr,
          starts_at: asIso(saved.startsAt),
          ends_at: asIso(saved.endsAt),
          max_redemptions: saved.maxRedemptions,
          is_active: saved.isActive,
        },
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await AdminSecurityService.writeAlert(
      'PAYOUT',
      `Super Admin ${currentUser.id} mengubah kupon ${cleanCode} menjadi ${this.describeDiscount(saved)}. Alasan: ${reason}`,
      'info'
    );

    return toView(saved);
  }

  static async setActive(
    currentUser: CouponActor,
    code: string,
    input: { isActive: boolean; reason: string; password?: string | null },
    meta: RequestMeta = {}
  ) {
    this.assertSuperAdmin(currentUser);
    await AdminSecurityService.assertReauth(currentUser.id, input.password);
    const reason = assertReason(input.reason, 'perubahan status kupon');
    const cleanCode = normalizeCouponCode(code);

    const previous = await this.findRow(cleanCode);
    if (!previous) fail(404, 'COUPON_NOT_FOUND', 'Kupon tidak ditemukan');

    const saved = await prisma.coupon.update({
      where: { code: cleanCode },
      data: { isActive: input.isActive, updatedById: currentUser.id },
      select,
    });

    await AdminSecurityService.writeAudit({
      actorId: currentUser.id,
      action: 'COUPON_STATUS_CHANGED',
      targetType: 'Coupon',
      targetId: cleanCode,
      reason,
      metadata: {
        code: cleanCode,
        previous_value: previous.isActive,
        new_value: input.isActive,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await AdminSecurityService.writeAlert(
      'PAYOUT',
      `Super Admin ${currentUser.id} ${input.isActive ? 'mengaktifkan' : 'menonaktifkan'} kupon ${cleanCode}. Alasan: ${reason}`,
      input.isActive ? 'info' : 'error'
    );

    return toView(saved);
  }

  private static describeDiscount(row: Row) {
    return row.discountType === 'PERCENT'
      ? `${row.discountValue}%${row.maxDiscountIdr ? ` maks Rp${row.maxDiscountIdr}` : ''}`
      : `potongan Rp${row.discountValue}`;
  }

  private static assertSuperAdmin(currentUser: CouponActor) {
    if (currentUser.role !== 'Super Admin') {
      fail(403, 'FORBIDDEN', 'Hanya Super Admin yang dapat mengubah kupon');
    }
  }

  private static failMissingTable(): never {
    fail(
      503,
      'COUPON_TABLE_MISSING',
      'Tabel kupon belum dimigrasi. Jalankan prisma migrate deploy lebih dulu.'
    );
  }

  private static async findRow(code: string): Promise<Row | null> {
    if (!code) return null;
    try {
      return await prisma.coupon.findUnique({ where: { code }, select });
    } catch (error) {
      if (isMissingTable(error)) this.failMissingTable();
      throw error;
    }
  }

  /** Dipakai halaman top-up untuk menjelaskan sisa minimal yang bisa ditagih. */
  static get minChargeableIdr() {
    return MIN_CHARGEABLE_IDR;
  }
}