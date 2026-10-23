import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminService } from '../src/services/admin.service.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    fess: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    vote: {
      count: vi.fn(),
    },
    base: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      count: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    systemSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    systemLog: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    platformConnection: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    payout: {
      create: vi.fn(),
    },
    $transaction: vi.fn((items) => (typeof items === 'function' ? items(prisma) : Promise.all(items))),
  },
}));

describe('AdminService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getStats', () => {
    it('should aggregate stats for admin', async () => {
      vi.mocked(prisma.fess.count)
        .mockResolvedValueOnce(50) // total
        .mockResolvedValueOnce(30) // published
        .mockResolvedValueOnce(15) // pending
        .mockResolvedValueOnce(5) // rejected
        .mockResolvedValueOnce(7); // reported

      vi.mocked(prisma.vote.count).mockResolvedValueOnce(200);
      vi.mocked(prisma.base.count).mockResolvedValueOnce(10);
      vi.mocked(prisma.user.count).mockResolvedValueOnce(100);

      const stats = await AdminService.getStats({
        id: 'usr_mod',
        role: 'Base Admin',
        managedBases: ['@codememfess'],
      });

      expect(stats.total_fesses).toBe(50);
      expect(stats.published).toBe(30);
      expect(stats.pending).toBe(15);
      expect(stats.rejected).toBe(5);
      expect(stats.reported).toBe(7);
      expect(stats.total_votes).toBe(200);
    });
  });

  describe('getModerationQueue', () => {
    it('should return pending fesses for moderation queue', async () => {
      vi.mocked(prisma.fess.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.fess.findMany).mockResolvedValueOnce([
        {
          id: 'fess_p1',
          baseHandle: '@codememfess',
          content: 'Pending fess',
          status: 'pending',
          createdAt: new Date(),
          comments: [],
        } as any,
      ]);

      const result = await AdminService.getModerationQueue({
        id: 'usr_mod',
        role: 'Base Admin',
        managedBases: ['@codememfess'],
      });

      expect(result.total).toBe(1);
      expect(result.data[0].id).toBe('fess_p1');
      expect(result.data[0].status).toBe('pending');
    });
  });

  describe('getSystemHealth & updateSecurityControls', () => {
    it('should return system health metrics', async () => {
      vi.mocked(prisma.fess.count).mockResolvedValueOnce(500);
      vi.mocked(prisma.base.count).mockResolvedValueOnce(25);
      vi.mocked(prisma.user.count).mockResolvedValueOnce(2);
      vi.mocked(prisma.systemSetting.findUnique).mockResolvedValueOnce(null);

      const health = await AdminService.getSystemHealth();
      expect(health.status).toBe('ok');
      expect(health.global_confessions_sent).toBe(500);
      expect(health.active_bases).toBe(25);
    });

    it('should update security controls and log changes', async () => {
      vi.mocked(prisma.fess.count).mockResolvedValue(500);
      vi.mocked(prisma.base.count).mockResolvedValue(25);
      vi.mocked(prisma.user.count).mockResolvedValue(2);
      vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue(null);

      const updated = await AdminService.updateSecurityControls({
        rate_limit_per_ip: 45,
        ai_filter_active: true,
      });

      expect(prisma.systemSetting.upsert).toHaveBeenCalled();
      expect(prisma.systemLog.create).toHaveBeenCalled();
      expect(updated.status).toBe('ok');
    });
  });

  describe('banUser', () => {
    it('should update user to banned status and log reason', async () => {
      const result = await AdminService.banUser('usr_spam', 'Spam promotion', 24);

      expect(prisma.user.update).toHaveBeenCalled();
      expect(prisma.systemLog.create).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });
  });

  describe('treasury & payout', () => {
    it('should get IDR treasury from base revenue wallets, never CTF', async () => {
      vi.mocked(prisma.base.findMany).mockResolvedValueOnce([
        {
          id: 'base_1',
          handle: '@codememfess',
          name: 'Code & Memes',
          revenueWallet: { pendingIdr: 5000, availableIdr: 15000, lifetimeIdr: 500000 },
        },
      ] as any);

      const treasury = await AdminService.getTreasury({
        id: 'usr_mod',
        role: 'Base Admin',
        managedBases: ['@codememfess'],
      });
      expect(treasury.balance).toBe(15000);
      expect(treasury.available_idr).toBe(15000);
      expect(treasury.pending_idr).toBe(5000);
      expect(treasury.currency).toBe('IDR');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should reject payout while BASE_PAYOUTS_ENABLED=false', async () => {
      await expect(
        AdminService.requestPayout({ id: 'usr_mod' }, 5000, '0xWallet')
      ).rejects.toMatchObject({ code: 'PAYOUTS_DISABLED', status: 503 });
      expect(prisma.payout.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('platform connections', () => {
    it('getPlatformConnections menyertakan token_expires_at dari metadata (khusus Instagram)', async () => {
      vi.mocked(prisma.platformConnection.findMany).mockResolvedValueOnce([
        {
          platform: 'instagram',
          connected: true,
          accountHandle: '@concern_fess',
          metadata: { tokenExpiresAt: '2026-12-16T00:00:00.000Z', igUserId: '1784' },
        },
        {
          platform: 'twitter',
          connected: false,
          accountHandle: '',
          metadata: null,
        },
      ] as any);

      const { data } = await AdminService.getPlatformConnections({ id: 'usr_1' });
      const ig = data.find((c: any) => c.id === 'instagram')!;
      const tw = data.find((c: any) => c.id === 'twitter')!;

      expect(ig.token_expires_at).toBe('2026-12-16T00:00:00.000Z');
      expect(ig.account_handle).toBe('@concern_fess');
      expect(tw.token_expires_at).toBeNull();
    });

    it('togglePlatformConnection disconnect → accessToken dihapus dari server', async () => {
      vi.mocked(prisma.platformConnection.upsert).mockResolvedValueOnce({
        platform: 'instagram',
        name: 'Instagram Graph API (Auto-Post Feed & Reels)',
        connected: false,
        status: 'idle',
        accountHandle: '@concern_fess',
      } as any);

      await AdminService.togglePlatformConnection({ id: 'usr_1' }, 'instagram', 'disconnect', '');

      expect(prisma.platformConnection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ connected: false, accessToken: null }),
        })
      );
    });
  });
});
