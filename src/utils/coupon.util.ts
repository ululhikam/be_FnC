import { MIN_CHARGEABLE_IDR } from '../constants/payments.js';

/**
 * Hitungan kupon murni (tanpa database) supaya aturan diskon bisa diuji
 * terpisah dari Prisma dan dipakai baik oleh pratinjau maupun pembuatan order.
 */

export type CouponDiscountType = 'FIXED' | 'PERCENT';

export type CouponRule = {
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
};

export type CouponQuoteInput = {
  coupon: CouponRule | null;
  amountIdr: number;
  /** Pemakaian aktif user ini untuk kupon tersebut (RESERVED + CONFIRMED). */
  userRedemptions?: number;
  now?: Date;
};

export type CouponRejection =
  | 'COUPON_NOT_FOUND'
  | 'COUPON_NOT_ACTIVE'
  | 'COUPON_NOT_STARTED'
  | 'COUPON_EXPIRED'
  | 'COUPON_MIN_AMOUNT'
  | 'COUPON_QUOTA_EXHAUSTED'
  | 'COUPON_ALREADY_USED'
  | 'COUPON_NO_BENEFIT'
  | 'COUPON_AMOUNT_TOO_LOW';

export type CouponQuote =
  | {
      ok: true;
      code: string;
      label: string;
      discountType: CouponDiscountType;
      /** Nilai mentah kupon: rupiah (FIXED) atau persen (PERCENT). */
      discountValue: number;
      discountIdr: number;
      amountIdr: number;
      finalAmountIdr: number;
    }
  | { ok: false; reason: CouponRejection; message: string };

function rupiah(value: number) {
  return `Rp${Math.max(0, Math.round(value)).toLocaleString('id-ID')}`;
}

/** Potongan rupiah: FIXED memakai nominal, PERCENT dibulatkan ke bawah. */
export function computeCouponDiscount(coupon: CouponRule, amountIdr: number): number {
  const raw =
    coupon.discountType === 'FIXED'
      ? Math.round(coupon.discountValue)
      : Math.floor((amountIdr * coupon.discountValue) / 100);
  const cappedByRule =
    coupon.discountType === 'PERCENT' && coupon.maxDiscountIdr != null
      ? Math.min(raw, coupon.maxDiscountIdr)
      : raw;
  return Math.max(0, Math.min(cappedByRule, amountIdr));
}

export function quoteCoupon(input: CouponQuoteInput): CouponQuote {
  const { coupon, amountIdr } = input;
  if (!coupon) {
    return { ok: false, reason: 'COUPON_NOT_FOUND', message: 'Kode kupon tidak ditemukan' };
  }
  if (!coupon.isActive) {
    return { ok: false, reason: 'COUPON_NOT_ACTIVE', message: 'Kupon sudah tidak aktif' };
  }

  const now = input.now ?? new Date();
  if (coupon.startsAt && now.getTime() < coupon.startsAt.getTime()) {
    return {
      ok: false,
      reason: 'COUPON_NOT_STARTED',
      message: `Kupon baru berlaku mulai ${coupon.startsAt.toISOString().slice(0, 10)}`,
    };
  }
  if (coupon.endsAt && now.getTime() > coupon.endsAt.getTime()) {
    return { ok: false, reason: 'COUPON_EXPIRED', message: 'Masa berlaku kupon sudah habis' };
  }
  if (coupon.minAmountIdr > 0 && amountIdr < coupon.minAmountIdr) {
    return {
      ok: false,
      reason: 'COUPON_MIN_AMOUNT',
      message: `Kupon hanya berlaku untuk pembelian minimal ${rupiah(coupon.minAmountIdr)}`,
    };
  }
  if (coupon.maxRedemptions != null && coupon.redemptionCount >= coupon.maxRedemptions) {
    return {
      ok: false,
      reason: 'COUPON_QUOTA_EXHAUSTED',
      message: 'Kuota kupon sudah habis',
    };
  }
  const used = input.userRedemptions ?? 0;
  if (coupon.maxPerUser > 0 && used >= coupon.maxPerUser) {
    return {
      ok: false,
      reason: 'COUPON_ALREADY_USED',
      message:
        coupon.maxPerUser === 1
          ? 'Kupon ini hanya bisa dipakai satu kali per akun'
          : `Kupon ini maksimal dipakai ${coupon.maxPerUser} kali per akun`,
    };
  }

  const discountIdr = computeCouponDiscount(coupon, amountIdr);
  if (discountIdr <= 0) {
    return {
      ok: false,
      reason: 'COUPON_NO_BENEFIT',
      message: 'Kupon ini tidak menghasilkan potongan untuk paket yang dipilih',
    };
  }

  const finalAmountIdr = amountIdr - discountIdr;
  if (finalAmountIdr < MIN_CHARGEABLE_IDR) {
    return {
      ok: false,
      reason: 'COUPON_AMOUNT_TOO_LOW',
      message: `Sisa pembayaran harus minimal ${rupiah(MIN_CHARGEABLE_IDR)}. Pilih paket yang lebih besar.`,
    };
  }

  return {
    ok: true,
    code: coupon.code,
    label: coupon.label,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    discountIdr,
    amountIdr,
    finalAmountIdr,
  };
}