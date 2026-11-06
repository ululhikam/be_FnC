import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import { invalidateCache } from '../src/utils/cache.util.js';
import { AdminSecurityService } from '../src/services/admin-security.service.js';
import { PaymentGatewayService } from '../src/services/payment-gateway.service.js';

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

const original = {
  serverKey: ENV.MIDTRANS_SERVER_KEY,
  clientKey: ENV.MIDTRANS_CLIENT_KEY,
  isProduction: ENV.MIDTRANS_IS_PRODUCTION,
};

const superAdmin = { id: 'admin_1', role: 'Super Admin' };

describe('PaymentGatewayService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCache('payment-gateway:');
    ENV.MIDTRANS_SERVER_KEY = 'SB-Mid-server-test';
    ENV.MIDTRANS_CLIENT_KEY = 'SB-Mid-client-test';
    ENV.MIDTRANS_IS_PRODUCTION = false;
    vi.mocked(prisma.adminAuditLog.create).mockResolvedValue({} as any);
    vi.mocked(prisma.systemLog.create).mockResolvedValue({} as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ password: 'hash' } as any);
    vi.spyOn(AdminSecurityService, 'assertReauth').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    ENV.MIDTRANS_SERVER_KEY = original.serverKey;
    ENV.MIDTRANS_CLIENT_KEY = original.clientKey;
    ENV.MIDTRANS_IS_PRODUCTION = original.isProduction;
  });

  it('defaults to core_api when the setting is missing', async () => {
    vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue(null);

    await expect(PaymentGatewayService.getMode({ fresh: true })).resolves.toBe('core_api');

    const config = await PaymentGatewayService.getConfig();
    expect(config.mode).toBe('core_api');
    expect(config.snap_client_key).toBe('SB-Mid-client-test');
    expect(config.snap_popup_ready).toBe(true);
    expect(config.snap_script_url).toContain('app.sandbox.midtrans.com/snap/snap.js');
  });

  it('reads snap from SystemSetting and caches the public config', async () => {
    vi.mocked(prisma.systemSetting.findUnique).mockResolvedValueOnce({
      value: { mode: 'snap' },
      updatedById: 'admin_1',
      updatedAt: new Date('2026-11-06T00:00:00.000Z'),
    } as any);

    const first = await PaymentGatewayService.getConfig();
    expect(first.mode).toBe('snap');

    // Panggilan kedua memakai cache, jadi tidak menyentuh database lagi.
    const second = await PaymentGatewayService.getConfig();
    expect(second.mode).toBe('snap');
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledOnce();
  });

  it('exposes a Super Admin view with the mode, options, and key readiness', async () => {
    vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue({
      value: { mode: 'snap' },
      updatedById: 'admin_1',
      updatedAt: new Date('2026-11-06T00:00:00.000Z'),
    } as any);

    const view = await PaymentGatewayService.getAdminView();

    expect(view.mode).toBe('snap');
    expect(view.source).toBe('database');
    expect(view.options.map((option) => option.value)).toEqual(['core_api', 'snap']);
    expect(view.snap_client_key_configured).toBe(true);
    expect(view.snap_popup_ready).toBe(true);
    expect(view.updated_by_id).toBe('admin_1');
  });

  it('writes the setting, audit log, and system alert when the mode changes', async () => {
    let setting: any = null;
    vi.mocked(prisma.systemSetting.findUnique).mockImplementation(async () => setting);
    vi.mocked(prisma.systemSetting.upsert).mockImplementation(async (args: any) => {
      setting = {
        ...args.create,
        updatedById: args.create.updatedById,
        updatedAt: new Date('2026-11-06T01:00:00.000Z'),
      };
      return setting;
    });

    const view = await PaymentGatewayService.setMode(
      superAdmin,
      { mode: 'snap', reason: 'Kanal Core API production belum aktif.', password: 'rahasia' },
      { ipAddress: '127.0.0.1', userAgent: 'vitest' }
    );

    expect(view.mode).toBe('snap');
    expect(AdminSecurityService.assertReauth).toHaveBeenCalledWith('admin_1', 'rahasia');
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'payment_gateway' },
      create: expect.objectContaining({
        key: 'payment_gateway',
        value: { mode: 'snap' },
        updatedById: 'admin_1',
      }),
      update: expect.objectContaining({
        value: { mode: 'snap' },
        updatedById: 'admin_1',
      }),
    });
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin_1',
        action: 'PAYMENT_GATEWAY_MODE_CHANGED',
        targetType: 'SystemSetting',
        targetId: 'payment_gateway',
        reason: 'Kanal Core API production belum aktif.',
        metadata: expect.objectContaining({
          previous_mode: 'core_api',
          new_mode: 'snap',
        }),
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      }),
    });
    expect(prisma.systemLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: 'PAYOUT',
        message: expect.stringContaining('core_api → snap'),
      }),
    });
  });

  it('rejects non-Super-Admin actors before re-auth', async () => {
    await expect(
      PaymentGatewayService.setMode(
        { id: 'base_admin', role: 'Base Admin' },
        { mode: 'snap', reason: 'Coba ubah mode.', password: 'rahasia' }
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    expect(AdminSecurityService.assertReauth).not.toHaveBeenCalled();
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it('requires a meaningful reason before writing', async () => {
    await expect(
      PaymentGatewayService.setMode(superAdmin, {
        mode: 'snap',
        reason: 'x',
        password: 'rahasia',
      })
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED', status: 422 });

    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });
});
