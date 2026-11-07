import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { invalidateCache } from '../src/utils/cache.util.js';
import { AdminSecurityService } from '../src/services/admin-security.service.js';
import { PaymentMethodService } from '../src/services/payment-method.service.js';

vi.mock('../src/config/prisma.js', () => {
  const prisma: any = {
    systemSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
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
  };
  return { prisma };
});

const superAdmin = { id: 'admin_1', role: 'Super Admin' };

const ALL_CODES = [
  'qris',
  'bca_va',
  'bni_va',
  'bri_va',
  'cimb_va',
  'permata_va',
  'mandiri_bill',
  'gopay',
  'shopeepay',
];

describe('PaymentMethodService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCache('payment-methods:');
    vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.systemSetting.upsert).mockResolvedValue({} as any);
    vi.mocked(prisma.adminAuditLog.create).mockResolvedValue({} as any);
    vi.mocked(prisma.systemLog.create).mockResolvedValue({} as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ password: 'hash' } as any);
    vi.spyOn(AdminSecurityService, 'assertReauth').mockResolvedValue(undefined);
  });

  it('offers the whole catalog when no setting exists', async () => {
    const methods = await PaymentMethodService.getEnabledMethods({ fresh: true });

    expect(methods.map((method) => method.code)).toEqual(ALL_CODES);
  });

  it('hides only the methods listed as disabled', async () => {
    vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue({
      value: { disabled: ['gopay', 'shopeepay'] },
    } as any);

    const methods = await PaymentMethodService.getEnabledMethods({ fresh: true });

    expect(methods.map((method) => method.code)).not.toContain('gopay');
    expect(methods.map((method) => method.code)).not.toContain('shopeepay');
    expect(methods.map((method) => method.code)).toHaveLength(7);
  });

  it('ignores unknown codes and refuses to disable the whole catalog', async () => {
    vi.mocked(prisma.systemSetting.findUnique).mockResolvedValueOnce({
      value: { disabled: ['qris', 'metode_lama'] },
    } as any);
    await expect(PaymentMethodService.getDisabledCodes({ fresh: true })).resolves.toEqual(['qris']);

    // Setting rusak yang mematikan semua metode diabaikan agar top-up tidak mati.
    vi.mocked(prisma.systemSetting.findUnique).mockResolvedValueOnce({
      value: { disabled: ALL_CODES },
    } as any);
    await expect(PaymentMethodService.getEnabledMethods({ fresh: true })).resolves.toHaveLength(9);
  });

  it('treats a method outside the catalog as unavailable', async () => {
    await expect(PaymentMethodService.isEnabled('bitcoin', { fresh: true })).resolves.toBe(false);
    await expect(PaymentMethodService.isEnabled('qris', { fresh: true })).resolves.toBe(true);
  });

  it('builds a Super Admin view with the current expiry policy', async () => {
    vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue({
      value: { disabled: ['qris'] },
      updatedById: 'admin_1',
      updatedAt: new Date('2026-11-06T00:00:00.000Z'),
    } as any);

    const view = await PaymentMethodService.getAdminView();

    expect(view.enabled_count).toBe(8);
    expect(view.disabled_count).toBe(1);
    expect(view.expiry_minutes).toBe(10);
    expect(view.source).toBe('database');
    expect(view.methods.find((method) => method.code === 'qris')?.enabled).toBe(false);
    expect(view.updated_by_id).toBe('admin_1');
  });

  it('stores the disabled list, writes audit, and alerts the engine log', async () => {
    // Emulasi penyimpanan nyata: view admin dibaca ulang dari DB setelah upsert.
    let stored: any = null;
    vi.mocked(prisma.systemSetting.findUnique).mockImplementation(async () => stored);
    vi.mocked(prisma.systemSetting.upsert).mockImplementation(async (args: any) => {
      stored = { value: args.create.value, updatedById: 'admin_1', updatedAt: new Date() };
      return stored;
    });

    const view = await PaymentMethodService.setEnabled(
      superAdmin,
      {
        enabled: ALL_CODES.filter((code) => code !== 'gopay'),
        reason: 'Kanal GoPay belum aktif di production',
        password: 'rahasia',
      },
      { ipAddress: '127.0.0.1', userAgent: 'vitest' }
    );

    expect(view.enabled_count).toBe(8);
    expect(AdminSecurityService.assertReauth).toHaveBeenCalledWith('admin_1', 'rahasia');
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'payment_methods' },
      create: expect.objectContaining({
        key: 'payment_methods',
        value: { disabled: ['gopay'], order: ALL_CODES },
        updatedById: 'admin_1',
      }),
      update: expect.objectContaining({
        value: { disabled: ['gopay'], order: ALL_CODES },
        updatedById: 'admin_1',
      }),
    });
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin_1',
        action: 'PAYMENT_METHODS_CHANGED',
        targetType: 'SystemSetting',
        targetId: 'payment_methods',
        reason: 'Kanal GoPay belum aktif di production',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      }),
    });
    expect(prisma.systemLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: 'PAYOUT',
        message: expect.stringContaining('mengubah metode pembayaran'),
      }),
    });
  });

  it('rejects a selection that disables every method', async () => {
    await expect(
      PaymentMethodService.setEnabled(superAdmin, {
        enabled: [],
        reason: 'Coba matikan semua metode',
        password: 'rahasia',
      })
    ).rejects.toMatchObject({ code: 'PAYMENT_METHODS_EMPTY', status: 422 });

    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it('rejects unknown codes and non-Super-Admin actors', async () => {
    await expect(
      PaymentMethodService.setEnabled(superAdmin, {
        enabled: ['qris', 'bitcoin'],
        reason: 'Coba metode tidak dikenal',
        password: 'rahasia',
      })
    ).rejects.toMatchObject({ code: 'INVALID_PAYMENT_METHODS', status: 422 });

    await expect(
      PaymentMethodService.setEnabled(
        { id: 'base_admin', role: 'Base Admin' },
        { enabled: ['qris'], reason: 'Coba ubah metode', password: 'rahasia' }
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it('applies the display order chosen by the Super Admin', async () => {
    vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue({
      value: { disabled: [], order: ['gopay', 'qris', 'bca_va'] },
    } as any);

    const methods = await PaymentMethodService.getEnabledMethods({ fresh: true });
    const codes = methods.map((method) => method.code);

    expect(codes.slice(0, 3)).toEqual(['gopay', 'qris', 'bca_va']);
    // Metode yang belum diurutkan tetap tampil setelahnya, tanpa duplikat.
    expect(codes).toHaveLength(ALL_CODES.length);
    expect(new Set(codes).size).toBe(ALL_CODES.length);
  });

  it('keeps the previous order when only the enabled list is saved', async () => {
    let stored: any = { value: { disabled: [], order: ['shopeepay', 'qris'] } };
    vi.mocked(prisma.systemSetting.findUnique).mockImplementation(async () => stored);
    vi.mocked(prisma.systemSetting.upsert).mockImplementation(async (args: any) => {
      stored = { value: args.update.value, updatedById: 'admin_1', updatedAt: new Date() };
      return stored;
    });

    await PaymentMethodService.setEnabled(superAdmin, {
      enabled: ALL_CODES.filter((code) => code !== 'gopay'),
      reason: 'Matikan GoPay sementara',
      password: 'rahasia',
    });

    const saved = vi.mocked(prisma.systemSetting.upsert).mock.calls[0][0] as any;
    expect(saved.update.value.order.slice(0, 2)).toEqual(['shopeepay', 'qris']);
    expect(saved.update.value.disabled).toEqual(['gopay']);
  });

  it('stores a new order together with the enabled list', async () => {
    let stored: any = null;
    vi.mocked(prisma.systemSetting.findUnique).mockImplementation(async () => stored);
    vi.mocked(prisma.systemSetting.upsert).mockImplementation(async (args: any) => {
      stored = { value: args.update.value, updatedById: 'admin_1', updatedAt: new Date() };
      return stored;
    });

    const view = await PaymentMethodService.setEnabled(superAdmin, {
      enabled: ALL_CODES,
      order: ['qris', 'gopay', 'shopeepay'],
      reason: 'QRIS dan e-wallet paling sering dipakai',
      password: 'rahasia',
    });

    expect(view.order.slice(0, 3)).toEqual(['qris', 'gopay', 'shopeepay']);
    expect(view.order).toHaveLength(ALL_CODES.length);
    expect(view.methods[0].code).toBe('qris');
  });

  it('rejects an unknown code in the order list', async () => {
    await expect(
      PaymentMethodService.setEnabled(superAdmin, {
        enabled: ALL_CODES,
        order: ['qris', 'bitcoin'],
        reason: 'Coba urutan tidak dikenal',
        password: 'rahasia',
      })
    ).rejects.toMatchObject({ code: 'INVALID_PAYMENT_METHOD_ORDER', status: 422 });

    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it('exposes the VA minimum amount in the admin view', async () => {
    const view = await PaymentMethodService.getAdminView();
    const byCode = new Map(view.methods.map((method) => [method.code, method]));

    expect(byCode.get('bca_va')?.min_amount_idr).toBe(10_000);
    expect(byCode.get('mandiri_bill')?.min_amount_idr).toBe(10_000);
    expect(byCode.get('qris')?.min_amount_idr).toBeNull();
    expect(byCode.get('gopay')?.min_amount_idr).toBeNull();
  });
});