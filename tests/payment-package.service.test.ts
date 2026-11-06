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

  describe('harga massal (satu harga per CTF + bonus)', () => {
    const rows = [
      row({ code: 'coba_dulu', name: 'Coba Dulu', amountIdr: 5000, ctfAmount: 25, sortOrder: 10 }),
      row({ code: 'hemat', name: 'Hemat', amountIdr: 10000, ctfAmount: 55, sortOrder: 20 }),
    ];

    const priceInput = {
      pricePerCtf: 600,
      packages: [
        { code: 'coba_dulu', bonusCtf: 0 },
        { code: 'hemat', bonusCtf: 2 },
      ],
      reason: 'Menyesuaikan harga dasar CTF menjadi Rp600',
      password: 'secret123',
    };

    beforeEach(() => {
      vi.mocked(prisma.paymentPackage.findMany).mockResolvedValue(rows as any);
      vi.mocked(prisma.paymentPackage.update).mockImplementation(
        async ({ where, data }: any) => ({ ...row({ code: where.code }), ...data }) as any
      );
    });

    it('menghitung floor(nominal / harga per CTF) lalu menambah bonus', async () => {
      const preview = await PaymentPackageService.previewBulkPrice(priceInput);

      expect(preview.packages).toEqual([
        expect.objectContaining({ code: 'coba_dulu', baseCtf: 8, bonusCtf: 0, ctfAmount: 8 }),
        expect.objectContaining({ code: 'hemat', baseCtf: 16, bonusCtf: 2, ctfAmount: 18 }),
      ]);
    });

    it('membulatkan ke bawah supaya CTF tidak melebihi kuota harga dasar', async () => {
      vi.mocked(prisma.paymentPackage.findMany).mockResolvedValue([
        row({ code: 'kecil', amountIdr: 1000, ctfAmount: 1 }),
      ] as any);

      const preview = await PaymentPackageService.previewBulkPrice({
        ...priceInput,
        packages: [{ code: 'kecil', bonusCtf: 0 }],
      });

      expect(preview.packages[0].baseCtf).toBe(1);
      expect(preview.packages[0].ctfAmount).toBe(1);
    });

    it('pratinjau tidak menulis apa pun', async () => {
      const preview = await PaymentPackageService.previewBulkPrice(priceInput);

      expect(preview.price_per_ctf).toBe(600);
      expect(preview.packages.map((item) => item.ctfAmount)).toEqual([8, 18]);
      expect(prisma.paymentPackage.update).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('menyimpan semua paket yang berubah dalam satu transaksi + audit', async () => {
      const result = await PaymentPackageService.bulkPrice(superAdmin, priceInput);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.paymentPackage.update).toHaveBeenCalledTimes(2);
      expect(prisma.paymentPackage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { code: 'hemat' },
          data: { ctfAmount: 18, updatedById: superAdmin.id },
        })
      );

      const audit = vi.mocked(prisma.adminAuditLog.create).mock.calls[0][0] as any;
      expect(audit.data.action).toBe('PAYMENT_PACKAGE_PRICING_CHANGED');
      expect(audit.data.targetId).toBe('bulk');
      expect(audit.data.metadata.price_per_ctf).toBe(600);
      expect(audit.data.metadata.packages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'hemat', previous_ctf_amount: 55, ctf_amount: 18 }),
        ])
      );
      expect(result.changed).toBe(2);
    });

    it('melewati paket yang nilainya tidak berubah', async () => {
      vi.mocked(prisma.paymentPackage.findMany).mockResolvedValue([
        row({ code: 'hemat', amountIdr: 10000, ctfAmount: 16 }),
      ] as any);

      const result = await PaymentPackageService.bulkPrice(superAdmin, {
        ...priceInput,
        packages: [{ code: 'hemat', bonusCtf: 0 }],
      });

      expect(prisma.paymentPackage.update).not.toHaveBeenCalled();
      expect(result.changed).toBe(0);
    });

    it('menolak harga per CTF yang membuat paket di bawah 1 CTF', async () => {
      await expect(
        PaymentPackageService.bulkPrice(superAdmin, { ...priceInput, pricePerCtf: 25000 })
      ).rejects.toMatchObject({ status: 422, code: 'PACKAGE_CTF_TOO_SMALL' });
      expect(prisma.paymentPackage.update).not.toHaveBeenCalled();
    });

    it('menolak harga per CTF di bawah batas minimum', async () => {
      await expect(
        PaymentPackageService.bulkPrice(superAdmin, { ...priceInput, pricePerCtf: 99 })
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_PRICE_PER_CTF' });
    });

    it('menolak bonus yang tidak lengkap untuk semua paket', async () => {
      await expect(
        PaymentPackageService.bulkPrice(superAdmin, {
          ...priceInput,
          packages: [{ code: 'hemat', bonusCtf: 2 }],
        })
      ).rejects.toMatchObject({ status: 422, code: 'PACKAGE_BONUS_MISSING' });
    });

    it('menolak kode paket yang tidak dikenal', async () => {
      await expect(
        PaymentPackageService.bulkPrice(superAdmin, {
          ...priceInput,
          packages: [...priceInput.packages, { code: 'tidak_ada', bonusCtf: 1 }],
        })
      ).rejects.toMatchObject({ status: 422, code: 'UNKNOWN_PACKAGE_CODE' });
    });

    it('menolak Base Admin mengubah harga massal', async () => {
      await expect(
        PaymentPackageService.bulkPrice(baseAdmin, priceInput)
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    });
  });
});