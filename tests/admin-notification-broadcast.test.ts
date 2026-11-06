import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/prisma.js', () => {
  const client: any = {
    user: { findMany: vi.fn(), count: vi.fn() },
    notification: { createMany: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    systemLog: { create: vi.fn() },
  };
  return { prisma: client };
});

vi.mock('../src/services/admin-security.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/admin-security.service.js')>();
  return {
    ...actual,
    AdminSecurityService: {
      ...actual.AdminSecurityService,
      assertReauth: vi.fn(),
      writeAudit: vi.fn(),
      writeAlert: vi.fn(),
    },
  };
});

import { prisma } from '../src/config/prisma.js';
import { AdminSecurityService } from '../src/services/admin-security.service.js';
import {
  AdminNotificationService,
  BROADCAST_BATCH_SIZE,
  audienceWhere,
  composeBroadcastText,
} from '../src/services/admin-notification.service.js';

const INPUT = {
  title: 'Pemeliharaan layanan',
  body: 'Layanan berhenti sementara pukul 23.00 WIB.',
  audience: 'users' as const,
  reason: 'Menginformasikan jadwal pemeliharaan',
  password: 'secret123',
};

function recipients(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `usr_${index + 1}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(AdminSecurityService.assertReauth).mockResolvedValue(undefined);
  vi.mocked(AdminSecurityService.writeAudit).mockResolvedValue(undefined as any);
  vi.mocked(AdminSecurityService.writeAlert).mockResolvedValue(undefined as any);
  vi.mocked(prisma.notification.createMany).mockResolvedValue({ count: 1 } as any);
});

describe('helper blast notifikasi', () => {
  it('menggabungkan judul dan isi dengan baris kosong', () => {
    expect(composeBroadcastText('  Judul  ', '  Isi  ')).toBe('Judul\n\nIsi');
  });

  it('mengecualikan akun terblokir di semua audiens', () => {
    expect(audienceWhere('all')).toEqual({ isBanned: false });
    expect(audienceWhere('users')).toEqual({ isBanned: false, role: 'User' });
    expect(audienceWhere('base_admins')).toEqual({ isBanned: false, role: 'Base Admin' });
  });
});

describe('AdminNotificationService', () => {
  it('menghitung penerima tanpa menulis apa pun', async () => {
    vi.mocked(prisma.user.count).mockResolvedValue(42);

    const result = await AdminNotificationService.preview('base_admins');

    expect(result).toEqual({ audience: 'base_admins', recipients: 42 });
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('mengirim satu notifikasi per penerima dengan tipe system', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue(recipients(3) as any);

    const result = await AdminNotificationService.broadcast('usr_admin', INPUT);

    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    const { data } = vi.mocked(prisma.notification.createMany).mock.calls[0][0] as any;
    expect(data).toHaveLength(3);
    expect(data[0]).toEqual({
      userId: 'usr_1',
      type: 'system',
      text: 'Pemeliharaan layanan\n\nLayanan berhenti sementara pukul 23.00 WIB.',
    });
    expect(result).toMatchObject({ recipients: 3, created: 3, batches: 1 });
  });

  it('memecah pengiriman menjadi batch 500 baris', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue(
      recipients(BROADCAST_BATCH_SIZE * 2 + 1) as any
    );

    const result = await AdminNotificationService.broadcast('usr_admin', INPUT);

    expect(prisma.notification.createMany).toHaveBeenCalledTimes(3);
    const sizes = vi
      .mocked(prisma.notification.createMany)
      .mock.calls.map((call: any) => call[0].data.length);
    expect(sizes).toEqual([500, 500, 1]);
    expect(result).toMatchObject({ created: 1001, batches: 3 });
  });

  it('mewajibkan re-auth sebelum mengirim', async () => {
    vi.mocked(AdminSecurityService.assertReauth).mockRejectedValue(
      Object.assign(new Error('Konfirmasi kata sandi diperlukan'), {
        code: 'REAUTH_REQUIRED',
        status: 401,
      })
    );

    await expect(AdminNotificationService.broadcast('usr_admin', INPUT)).rejects.toMatchObject({
      code: 'REAUTH_REQUIRED',
    });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('menolak alasan yang terlalu pendek', async () => {
    await expect(
      AdminNotificationService.broadcast('usr_admin', { ...INPUT, reason: 'ok' })
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED', status: 422 });
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('mencatat audit + alert setelah pengiriman', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue(recipients(2) as any);

    await AdminNotificationService.broadcast('usr_admin', INPUT, {
      ipAddress: '10.0.0.9',
      userAgent: 'vitest',
    });

    expect(AdminSecurityService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'usr_admin',
        action: 'NOTIFICATION_BROADCAST',
        targetType: 'Notification',
        targetId: 'users',
        reason: INPUT.reason,
        ipAddress: '10.0.0.9',
        userAgent: 'vitest',
        metadata: expect.objectContaining({ recipients: 2, created: 2, batches: 1 }),
      })
    );
    expect(AdminSecurityService.writeAlert).toHaveBeenCalledWith(
      'NOTIFICATION',
      expect.stringContaining('2 pengguna'),
      'info'
    );
  });

  it('tidak menulis apa pun saat audiens kosong', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    const result = await AdminNotificationService.broadcast('usr_admin', INPUT);

    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ recipients: 0, created: 0, batches: 0 });
  });
});
