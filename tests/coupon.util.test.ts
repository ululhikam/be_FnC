import { describe, expect, it } from 'vitest';
import {
  computeCouponDiscount,
  quoteCoupon,
  type CouponRule,
} from '../src/utils/coupon.util.js';

function rule(overrides: Partial<CouponRule> = {}): CouponRule {
  return {
    code: 'HEMAT10',
    label: 'Potongan Rp2.000',
    discountType: 'FIXED',
    discountValue: 2000,
    maxDiscountIdr: null,
    minAmountIdr: 0,
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    redemptionCount: 0,
    maxPerUser: 1,
    isActive: true,
    ...overrides,
  };
}

describe('computeCouponDiscount', () => {
  it('memakai nominal tetap untuk tipe FIXED', () => {
    expect(computeCouponDiscount(rule(), 5000)).toBe(2000);
  });

  it('membulatkan diskon persen ke bawah', () => {
    expect(
      computeCouponDiscount(
        rule({ discountType: 'PERCENT', discountValue: 15, maxDiscountIdr: null }),
        10_000
      )
    ).toBe(1500);
    expect(
      computeCouponDiscount(
        rule({ discountType: 'PERCENT', discountValue: 10, maxDiscountIdr: null }),
        55_555
      )
    ).toBe(5555);
  });

  it('membatasi diskon persen dengan maxDiscountIdr', () => {
    expect(
      computeCouponDiscount(
        rule({ discountType: 'PERCENT', discountValue: 50, maxDiscountIdr: 3000 }),
        20_000
      )
    ).toBe(3000);
  });

  it('tidak pernah melebihi harga paket', () => {
    expect(computeCouponDiscount(rule({ discountValue: 9000 }), 5000)).toBe(5000);
  });
});

describe('quoteCoupon', () => {
  it('menghitung sisa bayar dari harga paket', () => {
    expect(quoteCoupon({ coupon: rule(), amountIdr: 5000 })).toMatchObject({
      ok: true,
      code: 'HEMAT10',
      discountIdr: 2000,
      finalAmountIdr: 3000,
    });
  });

  it('menolak kupon yang tidak ada', () => {
    expect(quoteCoupon({ coupon: null, amountIdr: 5000 })).toMatchObject({
      ok: false,
      reason: 'COUPON_NOT_FOUND',
    });
  });

  it('menolak kupon nonaktif', () => {
    expect(quoteCoupon({ coupon: rule({ isActive: false }), amountIdr: 5000 })).toMatchObject({
      ok: false,
      reason: 'COUPON_NOT_ACTIVE',
    });
  });

  it('menolak sebelum tanggal mulai dan setelah tanggal berakhir', () => {
    const now = new Date('2026-10-28T12:00:00.000Z');
    expect(
      quoteCoupon({
        coupon: rule({ startsAt: new Date('2026-10-29T00:00:00.000Z') }),
        amountIdr: 5000,
        now,
      })
    ).toMatchObject({ ok: false, reason: 'COUPON_NOT_STARTED' });

    expect(
      quoteCoupon({
        coupon: rule({ endsAt: new Date('2026-10-27T00:00:00.000Z') }),
        amountIdr: 5000,
        now,
      })
    ).toMatchObject({ ok: false, reason: 'COUPON_EXPIRED' });
  });

  it('menolak di bawah minimum pembelian', () => {
    expect(
      quoteCoupon({ coupon: rule({ minAmountIdr: 10_000 }), amountIdr: 5000 })
    ).toMatchObject({ ok: false, reason: 'COUPON_MIN_AMOUNT' });
  });

  it('menolak saat kuota habis', () => {
    expect(
      quoteCoupon({
        coupon: rule({ maxRedemptions: 3, redemptionCount: 3 }),
        amountIdr: 5000,
      })
    ).toMatchObject({ ok: false, reason: 'COUPON_QUOTA_EXHAUSTED' });
  });

  it('menolak pemakaian kedua oleh user yang sama', () => {
    expect(
      quoteCoupon({ coupon: rule(), amountIdr: 5000, userRedemptions: 1 })
    ).toMatchObject({ ok: false, reason: 'COUPON_ALREADY_USED' });
  });

  it('menolak bila sisa bayar di bawah batas tagih', () => {
    expect(
      quoteCoupon({ coupon: rule({ discountValue: 4500 }), amountIdr: 5000 })
    ).toMatchObject({ ok: false, reason: 'COUPON_AMOUNT_TOO_LOW' });
  });

  it('menolak kupon yang tidak menghasilkan potongan', () => {
    expect(
      quoteCoupon({
        coupon: rule({ discountType: 'PERCENT', discountValue: 1, maxDiscountIdr: null }),
        amountIdr: 50,
      })
    ).toMatchObject({ ok: false, reason: 'COUPON_NO_BENEFIT' });
  });
});