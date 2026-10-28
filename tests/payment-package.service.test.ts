import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { PAYMENT_PACKAGES } from '../src/constants/payments.js';
import { PaymentPackageService } from '../src/services/payment-package.service.js';
import { invalidateCache } from '../src/utils/cache.util.js';

vi.mock('../src/config/prisma.js', () => {
  const prisma: any = {
    paymentPackage: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    adminAuditLog: {
      create: vi.fn(),
    },
    systemLog: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
  };
  return { prisma };
});

vi.mock('../src/utils/password.util.js', () => ({
  comparePassword: vi.fn(async (plain: string, hash: string) => hash === 'hashed:admin' && plain === 'secret123'),
  hashPassword: vi.fn(async (plain: string) => `hashed:${plain}`),
}));

const superAdmin = { id: 'usr_admin_01', role: 'Super Admin' };
const baseAdmin = { id: 'usr_base_01', role: 'Base Admin' };

function row(overrides: Record<string, unknown> = {}) {
  return {
    code: 'hemat',
    name: 'Hemat',
    amountIdr: 10000,
    ctfAmount: 55,
    description: 'Bonus 5 CTF dibanding paket Coba Dulu.',
    sortOrder: 20,
    isActive: true,
    updatedById: null,
    updatedAt: new Date('2026-10-28T00:00:00.000Z'),
    ...overrides,
  };
}

const packageInput = {
  name: 'Hemat',
  amountIdr: 12000,
  ctfAmount: 60,
  description: 'Paket hemat baru.',
  sortOrder: 20,
  isActive: true,
  reason: 'Penyesuaian harga kuartal empat',
  password: 'secret123',
};

describe('PaymentPackageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCache('payment-packages:');
    vi.mocked(prisma.paymentPackage.findMany).mockResolvedValue([row()] as any);
    vi.mocked(prisma.paymentPackage.findUnique).mockResolvedValue(row() as any);
    vi.mocked(prisma.paymentPackage.create).mockResolvedValue(row() as any);
    vi.mocked(prisma.paymentPackage.update).mockResolvedValue(row() as any);
    vi.mocked(prisma.adminAuditLog.create).mockResolvedValue({} as any);
    vi.mocked(prisma.systemLog.create).mockResolvedValue({} as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      password: 'hashed:admin',
      isBanned: false,
      banExpiresAt: null,
    } as any);
  });

  describe('katalog publik', () => {
    it('mengembalikan paket aktif dalam bentuk camelCase', async () => {
      const packages = await PaymentPackageService.listActive();
      expect(packages).toEqual([
        {
          code: 'hemat',
          name: 'Hemat',
          amountIdr: 10000,
          ctfAmount: 55,
          description: 'Bonus 5 CTF dibanding paket Coba Dulu.',
        },
      ]);
      expect(prisma.paymentPackage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } })
      );
    });

    it('memakai konstanta kode bila tabel belum dimigrasi', async () => {
      vi.mocked(prisma.paymentPackage.findMany).mockRejectedValue({ code: 'P2021' });
      const packages = await PaymentPackageService.listActive();
      expect(packages).toEqual(PAYMENT_PACKAGES);
    });

    it('menghormati admin yang menonaktifkan semua paket (tidak fallback)', async () => {
      vi.mocked(prisma.paymentPackage.findMany).mockResolvedValue([]);
      const packages = await PaymentPackageService.listActive();
      expect(packages).toEqual([]);
    });

    it('menyimpan hasil di cache sampai diinvalidasi', async () => {
      await PaymentPackageService.listActive();
      await PaymentPackageService.listActive();
      expect(prisma.paymentPackage.findMany).toHaveBeenCalledOnce();

      invalidateCache('payment-packages:');
      await PaymentPackageService.listActive();
      expect(prisma.paymentPackage.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('resolve paket untuk order', () => {
    it('menolak paket nonaktif', async () => {
      vi.mocked(prisma.paymentPackage.findUnique).mockResolvedValue(row({ isActive: false }) as any);
      await expect(PaymentPackageService.findForOrder('hemat')).resolves.toBeNull();
    });

    it('menolak kode paket yang tidak valid', async () => {
      await expect(PaymentPackageService.findForOrder('HEMAT!')).resolves.toBeNull();
      expect(prisma.paymentPackage.findUnique).not.toHaveBeenCalled();
    });

    it('memakai nominal terbaru dari database, bukan konstanta', async () => {
      vi.mocked(prisma.paymentPackage.findUnique).mockResolvedValue(
        row({ amountIdr: 12000, ctfAmount: 60 }) as any
      );
      await expect(PaymentPackageService.findForOrder('hemat')).resolves.toMatchObject({
        code: 'hemat',
        amountIdr: 12000,
        ctfAmount: 60,
      });
    });

    it('jatuh ke konstanta saat tabel belum ada', async () => {
      vi.mocked(prisma.paymentPackage.findUnique).mockRejectedValue({ code: 'P2021' });
      await expect(PaymentPackageService.findForOrder('bundling')).resolves.toMatchObject({
        code: 'bundling',
        amountIdr: 100000,
      });
    });
  });

  describe('mutasi admin', () => {
    it('menolak aktor selain Super Admin', async () => {
      await expect(
        PaymentPackageService.create(baseAdmin, {
          code: 'baru',
          ...packageInput,
        })
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
      expect(prisma.paymentPackage.create).not.toHaveBeenCalled();
    });

    it('menolak kata sandi konfirmasi yang salah', async () => {
      await expect(
        PaymentPackageService.create(superAdmin, {
          code: 'baru',
          ...packageInput,
          password: 'salah',
        })
      ).rejects.toMatchObject({ status: 403, code: 'REAUTH_INVALID' });
      expect(prisma.paymentPackage.create).not.toHaveBeenCalled();
    });

    it('mewajibkan alasan minimal 5 karakter', async () => {
      await expect(
        PaymentPackageService.update(superAdmin, 'hemat', { ...packageInput, reason: 'naik' })
      ).rejects.toMatchObject({ status: 422, code: 'REASON_REQUIRED' });
    });

    it('membuat paket baru, menulis audit, dan menginvalidasi cache', async () => {
      vi.mocked(prisma.paymentPackage.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.paymentPackage.create).mockResolvedValue(
        row({ code: 'nebeng_hemat', name: 'Nebeng Hemat', amountIdr: 12000, ctfAmount: 60 }) as any
      );
      await PaymentPackageService.listActive();

      const created = await PaymentPackageService.create(superAdmin, {
        code: 'Nebeng_Hemat',
        ...packageInput,
      });

      expect(created.code).toBe('nebeng_hemat');
      expect(prisma.paymentPackage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ code: 'nebeng_hemat', updatedById: superAdmin.id }),
        })
      );
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'PAYMENT_PACKAGE_CREATED' }),
        })
      );

      await PaymentPackageService.listActive();
      expect(prisma.paymentPackage.findMany).toHaveBeenCalledTimes(2);
    });

    it('menolak kode paket yang sudah dipakai', async () => {
      await expect(
        PaymentPackageService.create(superAdmin, { code: 'hemat', ...packageInput })
      ).rejects.toMatchObject({ status: 409, code: 'PACKAGE_CODE_TAKEN' });
      expect(prisma.paymentPackage.create).not.toHaveBeenCalled();
    });

    it('menyimpan perubahan dan mencatat nilai sebelum/sesudah di audit', async () => {
      vi.mocked(prisma.paymentPackage.findUnique).mockResolvedValue(row() as any);
      vi.mocked(prisma.paymentPackage.update).mockResolvedValue(
        row({ amountIdr: 12000, ctfAmount: 60, updatedById: superAdmin.id }) as any
      );

      const updated = await PaymentPackageService.update(superAdmin, 'hemat', packageInput);

      expect(updated).toMatchObject({ amount_idr: 12000, ctf_amount: 60 });
      const audit = vi.mocked(prisma.adminAuditLog.create).mock.calls[0][0] as any;
      expect(audit.data.action).toBe('PAYMENT_PACKAGE_UPDATED');
      expect(audit.data.metadata.previous).toMatchObject({ amount_idr: 10000, ctf_amount: 55 });
      expect(audit.data.metadata.next).toMatchObject({ amount_idr: 12000, ctf_amount: 60 });
    });

    it('menolak perubahan paket yang tidak ada', async () => {
      vi.mocked(prisma.paymentPackage.findUnique).mockResolvedValue(null);
      await expect(
        PaymentPackageService.update(superAdmin, 'tidak_ada', packageInput)
      ).rejects.toMatchObject({ status: 404, code: 'PACKAGE_NOT_FOUND' });
    });

    it('mengaktifkan/menonaktifkan paket dengan audit', async () => {
      vi.mocked(prisma.paymentPackage.update).mockResolvedValue(row({ isActive: false }) as any);

      const saved = await PaymentPackageService.setActive(superAdmin, 'hemat', {
        isActive: false,
        reason: 'Paket digabung ke Bundling',
        password: 'secret123',
      });

      expect(saved.is_active).toBe(false);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PAYMENT_PACKAGE_STATUS_CHANGED',
            metadata: expect.objectContaining({ previous_value: true, new_value: false }),
          }),
        })
      );
    });

    it('melaporkan 503 saat tabel paket belum dimigrasi', async () => {
      vi.mocked(prisma.paymentPackage.findUnique).mockRejectedValue({ code: 'P2021' });
      await expect(
        PaymentPackageService.update(superAdmin, 'hemat', packageInput)
      ).rejects.toMatchObject({ status: 503, code: 'PAYMENT_PACKAGE_TABLE_MISSING' });
    });
  });
});