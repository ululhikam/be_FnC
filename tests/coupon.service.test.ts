import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { CouponService } from '../src/services/coupon.service.js';

vi.mock('../src/config/prisma.js', () => {
  const prisma: any = {
    coupon: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    couponRedemption: {
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      groupBy: vi.fn(),
    },
    paymentPackage: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    adminAuditLog: { create: vi.fn() },
    systemLog: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
  };
  return { prisma };
});

vi.mock('../src/utils/password.util.js', () => ({
  comparePassword: vi.fn(
    async (plain: string, hash: string) => hash === 'hashed:admin' && plain === 'secret123'
  ),
  hashPassword: vi.fn(async (plain: string) => `hashed:${plain}`),
}));

const superAdmin = { id: 'usr_admin_01', role: 'Super Admin' };
const baseAdmin = { id: 'usr_base_01', role: 'Base Admin' };
const user = { id: 'usr_1' };

function couponRow(overrides: Record<string, unknown> = {}) {
  return {
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
    createdAt: new Date('2026-10-28T00:00:00.000Z'),
    updatedAt: new Date('2026-10-28T00:00:00.000Z'),
    ...overrides,
  };
}

const couponInput = {
  label: 'Potongan Rp2.000',
  discountType: 'FIXED' as const,
  discountValue: 2000,
  maxDiscountIdr: null,
  minAmountIdr: 0,
  startsAt: null,
  endsAt: null,
  maxRedemptions: 100,
  isActive: true,
  reason: 'Promo akhir tahun 2026',
  password: 'secret123',
};

const packageRow = {
  code: 'coba_dulu',
  name: 'Coba Dulu',
  amountIdr: 5000,
  ctfAmount: 25,
  description: 'Paket kecil untuk mencoba top-up dan publish.',
  sortOrder: 10,
  isActive: true,
  updatedById: null,
  updatedAt: new Date('2026-10-28T00:00:00.000Z'),
};

describe('CouponService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.coupon.findMany).mockResolvedValue([couponRow()] as any);
    vi.mocked(prisma.coupon.findUnique).mockResolvedValue(couponRow() as any);
    vi.mocked(prisma.coupon.create).mockResolvedValue(couponRow() as any);
    vi.mocked(prisma.coupon.update).mockResolvedValue(couponRow() as any);
    vi.mocked(prisma.coupon.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.couponRedemption.count).mockResolvedValue(0);
    vi.mocked(prisma.couponRedemption.create).mockResolvedValue({} as any);
    vi.mocked(prisma.couponRedemption.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.couponRedemption.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.couponRedemption.groupBy).mockResolvedValue([
      { couponCode: 'HEMAT10', _count: { _all: 2 } },
    ] as any);
    vi.mocked(prisma.paymentPackage.findUnique).mockResolvedValue(packageRow as any);
    vi.mocked(prisma.adminAuditLog.create).mockResolvedValue({} as any);
    vi.mocked(prisma.systemLog.create).mockResolvedValue({} as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      password: 'hashed:admin',
      isBanned: false,
      banExpiresAt: null,
    } as any);
  });

  describe('konsol admin', () => {
    it('memakai snake_case dan menghitung pemakaian yang sudah lunas', async () => {
      const result = await CouponService.listForAdmin();

      expect(result.source).toBe('database');
      expect(result.coupons[0]).toMatchObject({
        code: 'HEMAT10',
        discount_type: 'FIXED',
        discount_value: 2000,
        max_discount_idr: null,
        min_amount_idr: 0,
        max_redemptions: 100,
        redemption_count: 0,
        confirmed_count: 2,
        max_per_user: 1,
        is_active: true,
      });
    });

    it('mengembalikan daftar kosong bila tabel belum dimigrasi', async () => {
      vi.mocked(prisma.coupon.findMany).mockRejectedValue({ code: 'P2021' });
      await expect(CouponService.listForAdmin()).resolves.toEqual({
        source: 'fallback',
        coupons: [],
      });
    });
  });

  describe('mutasi admin', () => {
    it('menolak aktor selain Super Admin', async () => {
      await expect(
        CouponService.create(baseAdmin, { code: 'HEMAT10', ...couponInput })
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
      expect(prisma.coupon.create).not.toHaveBeenCalled();
    });

    it('menolak kata sandi konfirmasi yang salah', async () => {
      await expect(
        CouponService.create(superAdmin, {
          code: 'HEMAT10',
          ...couponInput,
          password: 'salah',
        })
      ).rejects.toMatchObject({ status: 403, code: 'REAUTH_INVALID' });
    });

    it('mewajibkan alasan minimal 5 karakter', async () => {
      await expect(
        CouponService.create(superAdmin, { code: 'HEMAT10', ...couponInput, reason: 'x' })
      ).rejects.toMatchObject({ status: 422, code: 'REASON_REQUIRED' });
    });

    it('menormalkan kode ke huruf besar dan menulis audit', async () => {
      vi.mocked(prisma.coupon.findUnique).mockResolvedValue(null);

      await CouponService.create(superAdmin, { code: 'hemat10', ...couponInput });

      expect(prisma.coupon.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            code: 'HEMAT10',
            maxPerUser: 1,
            createdById: superAdmin.id,
          }),
        })
      );
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'COUPON_CREATED', targetId: 'HEMAT10' }),
        })
      );
    });

    it('menolak kode yang sudah dipakai', async () => {
      await expect(
        CouponService.create(superAdmin, { code: 'HEMAT10', ...couponInput })
      ).rejects.toMatchObject({ status: 409, code: 'COUPON_CODE_TAKEN' });
      expect(prisma.coupon.create).not.toHaveBeenCalled();
    });

    it('menolak diskon persen di atas 100', async () => {
      await expect(
        CouponService.create(superAdmin, {
          code: 'LEBIH',
          ...couponInput,
          discountType: 'PERCENT',
          discountValue: 150,
        })
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_DISCOUNT_VALUE' });
    });

    it('menolak tanggal berakhir sebelum tanggal mulai', async () => {
      await expect(
        CouponService.create(superAdmin, {
          code: 'TANGGAL',
          ...couponInput,
          startsAt: '2026-11-10T00:00:00.000Z',
          endsAt: '2026-11-01T00:00:00.000Z',
        })
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_COUPON_DATE' });
    });

    it('tidak mengizinkan kuota di bawah pemakaian saat ini', async () => {
      vi.mocked(prisma.coupon.findUnique).mockResolvedValue(
        couponRow({ redemptionCount: 5 }) as any
      );

      await expect(
        CouponService.update(superAdmin, 'HEMAT10', { ...couponInput, maxRedemptions: 3 })
      ).rejects.toMatchObject({ status: 422, code: 'COUPON_QUOTA_BELOW_USAGE' });
      expect(prisma.coupon.update).not.toHaveBeenCalled();
    });

    it('mencatat nilai sebelum dan sesudah di audit', async () => {
      vi.mocked(prisma.coupon.update).mockResolvedValue(
        couponRow({ discountValue: 3000, updatedById: superAdmin.id }) as any
      );

      await CouponService.update(superAdmin, 'hemat10', { ...couponInput, discountValue: 3000 });

      const audit = vi.mocked(prisma.adminAuditLog.create).mock.calls[0][0] as any;
      expect(audit.data.action).toBe('COUPON_UPDATED');
      expect(audit.data.metadata.previous).toMatchObject({ discount_value: 2000 });
      expect(audit.data.metadata.next).toMatchObject({ discount_value: 3000 });
    });

    it('menonaktifkan kupon dengan audit', async () => {
      vi.mocked(prisma.coupon.update).mockResolvedValue(couponRow({ isActive: false }) as any);

      const saved = await CouponService.setActive(superAdmin, 'HEMAT10', {
        isActive: false,
        reason: 'Promo berakhir',
        password: 'secret123',
      });

      expect(saved.is_active).toBe(false);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'COUPON_STATUS_CHANGED',
            metadata: expect.objectContaining({ previous_value: true, new_value: false }),
          }),
        })
      );
    });

    it('melaporkan 503 saat tabel kupon belum dimigrasi', async () => {
      vi.mocked(prisma.coupon.findUnique).mockRejectedValue({ code: 'P2021' });
      await expect(
        CouponService.update(superAdmin, 'HEMAT10', couponInput)
      ).rejects.toMatchObject({ status: 503, code: 'COUPON_TABLE_MISSING' });
    });
  });

  describe('pratinjau untuk pengguna', () => {
    it('menghitung potongan tanpa mengunci kuota', async () => {
      const quote = await CouponService.preview(user, {
        code: 'hemat10',
        packageCode: 'coba_dulu',
      });

      expect(quote).toMatchObject({
        code: 'HEMAT10',
        discount_idr: 2000,
        amount_idr: 5000,
        final_amount_idr: 3000,
        ctf_amount: 25,
      });
      expect(prisma.coupon.updateMany).not.toHaveBeenCalled();
      expect(prisma.couponRedemption.create).not.toHaveBeenCalled();
    });

    it('menolak kupon yang sudah dipakai akun ini', async () => {
      vi.mocked(prisma.couponRedemption.count).mockResolvedValue(1);

      await expect(
        CouponService.preview(user, { code: 'HEMAT10', packageCode: 'coba_dulu' })
      ).rejects.toMatchObject({ status: 409, code: 'COUPON_ALREADY_USED' });
    });

    it('menolak kode kupon dengan format salah', async () => {
      await expect(
        CouponService.preview(user, { code: 'a!', packageCode: 'coba_dulu' })
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_COUPON_CODE' });
    });
  });

  describe('reservasi & pelepasan kuota', () => {
    it('mengunci kuota dan membuat baris RESERVED', async () => {
      const result = await CouponService.reserve(prisma as any, {
        code: 'hemat10',
        userId: 'usr_1',
        orderId: 'FNC-ORDER-1',
        amountIdr: 5000,
      });

      expect(result).toEqual({ code: 'HEMAT10', discountIdr: 2000, finalAmountIdr: 3000 });
      expect(prisma.coupon.updateMany).toHaveBeenCalledWith({
        where: { code: 'HEMAT10', isActive: true, redemptionCount: { lt: 100 } },
        data: { redemptionCount: { increment: 1 } },
      });
      expect(prisma.couponRedemption.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          couponCode: 'HEMAT10',
          orderId: 'FNC-ORDER-1',
          status: 'RESERVED',
          amountIdr: 5000,
          discountIdr: 2000,
        }),
      });
    });

    it('menolak saat kuota habis walau pembacaan awal masih tersisa', async () => {
      vi.mocked(prisma.coupon.updateMany).mockResolvedValue({ count: 0 } as any);

      await expect(
        CouponService.reserve(prisma as any, {
          code: 'HEMAT10',
          userId: 'usr_1',
          orderId: 'FNC-ORDER-1',
          amountIdr: 5000,
        })
      ).rejects.toMatchObject({ status: 409, code: 'COUPON_QUOTA_EXHAUSTED' });
      expect(prisma.couponRedemption.create).not.toHaveBeenCalled();
    });

    it('menolak pemakaian kedua oleh user yang sama', async () => {
      vi.mocked(prisma.couponRedemption.count).mockResolvedValue(1);

      await expect(
        CouponService.reserve(prisma as any, {
          code: 'HEMAT10',
          userId: 'usr_1',
          orderId: 'FNC-ORDER-2',
          amountIdr: 5000,
        })
      ).rejects.toMatchObject({ status: 409, code: 'COUPON_ALREADY_USED' });
      expect(prisma.couponRedemption.create).not.toHaveBeenCalled();
    });

    it('menandai CONFIRMED setelah lunas', async () => {
      await expect(CouponService.confirm(prisma as any, 'FNC-ORDER-1')).resolves.toBe(true);
      expect(prisma.couponRedemption.updateMany).toHaveBeenCalledWith({
        where: { orderId: 'FNC-ORDER-1', status: 'RESERVED' },
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      });
    });

    it('mengembalikan kuota saat order gagal', async () => {
      vi.mocked(prisma.couponRedemption.findUnique).mockResolvedValue({
        couponCode: 'HEMAT10',
        status: 'RESERVED',
      } as any);

      await expect(CouponService.release(prisma as any, 'FNC-ORDER-1')).resolves.toBe(true);
      expect(prisma.coupon.updateMany).toHaveBeenCalledWith({
        where: { code: 'HEMAT10', redemptionCount: { gt: 0 } },
        data: { redemptionCount: { decrement: 1 } },
      });
    });

    it('tidak melepas kuota yang sudah dikonfirmasi', async () => {
      vi.mocked(prisma.couponRedemption.findUnique).mockResolvedValue({
        couponCode: 'HEMAT10',
        status: 'CONFIRMED',
      } as any);

      await expect(CouponService.release(prisma as any, 'FNC-ORDER-1')).resolves.toBe(false);
      expect(prisma.coupon.updateMany).not.toHaveBeenCalled();
    });
  });
});