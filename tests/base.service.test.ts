import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseService } from '../src/services/base.service.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    base: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    fess: {
      updateMany: vi.fn(),
    },
    follow: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    platformConnection: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('BaseService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBases', () => {
    it('should return paginated bases with is_following computed', async () => {
      vi.mocked(prisma.base.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.base.findMany).mockResolvedValueOnce([
        {
          id: 'base_1',
          name: 'Code Base',
          handle: '@codebase',
          membersCount: 1500,
          verified: true,
          category: 'Hobi',
          createdAt: new Date(),
        } as any,
      ]);
      vi.mocked(prisma.follow.findMany).mockResolvedValueOnce([{ baseId: 'base_1' }] as any);

      const result = await BaseService.getBases({ page: 1, limit: 10 }, 'usr_1');

      expect(result.total).toBe(1);
      expect(result.data.length).toBe(1);
      expect(result.data[0].handle).toBe('@codebase');
      expect(result.data[0].is_following).toBe(true);
      expect(result.data[0].members).toBe('1.5k');
    });
  });

  describe('getBaseByHandle', () => {
    it('should throw error if base does not exist', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce(null);

      await expect(BaseService.getBaseByHandle('@nonexistent')).rejects.toThrow('tidak ditemukan');
    });

    it('should return base detail when exists', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        name: 'Code Base',
        handle: '@codebase',
        membersCount: 100,
        rules: ['Rule 1'],
      } as any);

      const base = await BaseService.getBaseByHandle('@codebase');
      expect(base.name).toBe('Code Base');
      expect(base.rules).toContain('Rule 1');
      expect(base).not.toHaveProperty('handle_change_available_at');
      expect(base).not.toHaveProperty('can_change_handle');
    });

    it('should expose handle cooldown metadata only to managers', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        name: 'Code Base',
        handle: '@codebase',
        creatorId: 'usr_1',
        handleChangedAt: new Date(),
        membersCount: 100,
      } as any);

      const base = await BaseService.getBaseByHandle('@codebase', {
        id: 'usr_1',
        role: 'Base Admin',
        managedBases: ['@codebase'],
      });

      expect(base.handle_change_cooldown_days).toBe(7);
      expect(base.can_change_handle).toBe(false);
      expect(base.handle_change_available_at).toEqual(expect.any(Number));
    });

    it('exposes trial billing state so the composer can show a free badge', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        name: 'Trial Base',
        handle: '@trialbase',
        trialEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        freeForever: false,
        membersCount: 10,
      } as any);

      const base = await BaseService.getBaseByHandle('@trialbase');

      expect(base.billing).toEqual({
        requires_payment: false,
        reason: 'trial',
        free_forever: false,
        trial_active: true,
        ctf_cost: 0,
      });
    });

    it('exposes paid billing and real Instagram connection status', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        name: 'Paid Base',
        handle: '@paidbase',
        creatorId: 'usr_1',
        trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        freeForever: false,
        membersCount: 10,
      } as any);
      vi.mocked(prisma.platformConnection.findUnique).mockResolvedValueOnce({
        connected: true,
        accessToken: 'ig-token',
      } as any);

      const base = await BaseService.getBaseByHandle('@paidbase');

      expect(base.billing).toEqual({
        requires_payment: true,
        reason: 'paid',
        free_forever: false,
        trial_active: false,
        ctf_cost: 1,
      });
      expect(base.instagram_connected).toBe(true);
    });
  });

  describe('toggleFollow', () => {
    it('should follow base if not currently followed', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codebase',
      } as any);
      vi.mocked(prisma.follow.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.$transaction).mockResolvedValueOnce([]);

      const result = await BaseService.toggleFollow('@codebase', 'usr_1');
      expect(result.is_following).toBe(true);
    });

    it('should unfollow base if currently followed', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codebase',
      } as any);
      vi.mocked(prisma.follow.findUnique).mockResolvedValueOnce({ id: 'f_1' } as any);
      vi.mocked(prisma.$transaction).mockResolvedValueOnce([]);

      const result = await BaseService.toggleFollow('@codebase', 'usr_1');
      expect(result.is_following).toBe(false);
    });
  });

  describe('getFollowingBases', () => {
    it('should paginate followed bases with search + sort', async () => {
      vi.mocked(prisma.follow.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.follow.findMany).mockResolvedValueOnce([
        {
          createdAt: new Date(),
          base: {
            id: 'base_1',
            name: 'Code Base',
            handle: '@codebase',
            membersCount: 10,
            category: 'Hobi',
          },
        },
      ] as any);

      const result = await BaseService.getFollowingBases('usr_1', {
        page: 1,
        limit: 10,
        sort: 'name',
        search: 'code',
      });

      expect(result.total).toBe(1);
      expect(result.data[0].handle).toBe('@codebase');
      expect(prisma.follow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
          orderBy: [{ base: { name: 'asc' } }],
        })
      );
      expect(prisma.follow.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'usr_1' }),
        })
      );
    });
  });

  describe('updateSettings', () => {
    it('should reject unauthorized user from updating base settings', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codebase',
        creatorId: 'other_user',
      } as any);

      await expect(
        BaseService.updateSettings(
          '@codebase',
          { id: 'usr_imposter', role: 'User', managedBases: [] },
          { name: 'Hacked Name' }
        )
      ).rejects.toThrow('tidak memiliki izin');
    });

    it('should sanitize, dedupe and persist banned words', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codebase',
        creatorId: 'usr_1',
      } as any);
      vi.mocked(prisma.base.update).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codebase',
        bannedWords: ['judi', 'slot'],
      } as any);

      const result = await BaseService.updateSettings(
        '@codebase',
        { id: 'usr_1', role: 'Base Admin', managedBases: ['@codebase'] },
        { bannedWords: [' Judi ', 'slot', 'judi', ''] }
      );

      const updateCall = vi.mocked(prisma.base.update).mock.calls[0][0] as any;
      // Duplikat case-insensitive dipangkas; varian terakhir yang menang.
      expect(updateCall.data.bannedWords).toEqual(['judi', 'slot']);
      expect(result.banned_words).toEqual(['judi', 'slot']);
    });

    it('changes base handle, records cooldown, and migrates fess snapshots', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codebase',
        creatorId: 'usr_1',
        handleChangedAt: null,
      } as any);
      vi.mocked(prisma.base.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);

      const changedAt = new Date();
      vi.mocked(prisma.base.update).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@newcode',
        handleChangedAt: changedAt,
      } as any);
      vi.mocked(prisma.fess.updateMany).mockResolvedValueOnce({ count: 3 } as any);
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: any) =>
        callback(prisma)
      );

      const result = await BaseService.updateSettings(
        '@codebase',
        { id: 'usr_1', role: 'Base Admin', managedBases: ['@codebase'] },
        { handle: 'newcode' }
      );

      expect(prisma.base.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'base_1' },
          data: expect.objectContaining({
            handle: '@newcode',
            handleChangedAt: expect.any(Date),
          }),
        })
      );
      expect(prisma.fess.updateMany).toHaveBeenCalledWith({
        where: {
          OR: [{ baseId: 'base_1' }, { baseHandle: '@codebase' }],
        },
        data: { baseHandle: '@newcode' },
      });
      expect(result.handle).toBe('@newcode');
      expect(result.handle_change_cooldown_days).toBe(7);
      expect(result.can_change_handle).toBe(false);
    });

    it('rejects a base handle change while the 7-day cooldown is active', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codebase',
        creatorId: 'usr_1',
        handleChangedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      } as any);

      await expect(
        BaseService.updateSettings(
          '@codebase',
          { id: 'usr_1', role: 'Base Admin', managedBases: ['@codebase'] },
          { handle: '@newcode' }
        )
      ).rejects.toMatchObject({
        status: 429,
        code: 'HANDLE_CHANGE_COOLDOWN',
      });

      expect(prisma.base.findFirst).not.toHaveBeenCalled();
      expect(prisma.base.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not consume the base cooldown for the same handle', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codebase',
        creatorId: 'usr_1',
        handleChangedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      } as any);
      vi.mocked(prisma.base.update).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codebase',
        handleChangedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      } as any);

      await BaseService.updateSettings(
        '@codebase',
        { id: 'usr_1', role: 'Base Admin', managedBases: ['@codebase'] },
        { name: 'Code Base Updated', handle: '@codebase' }
      );

      expect(prisma.base.findFirst).not.toHaveBeenCalled();
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.base.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: 'Code Base Updated' },
        })
      );
    });

    it('rejects a base handle already used by another base or user', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codebase',
        creatorId: 'usr_1',
        handleChangedAt: null,
      } as any);
      vi.mocked(prisma.base.findFirst).mockResolvedValueOnce({ id: 'base_2' } as any);
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);

      await expect(
        BaseService.updateSettings(
          '@codebase',
          { id: 'usr_1', role: 'Base Admin', managedBases: ['@codebase'] },
          { handle: '@taken' }
        )
      ).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
      });

      expect(prisma.base.update).not.toHaveBeenCalled();
    });
  });
});

describe('BaseService.serializeBase — privasi filter kata', () => {
  const row = {
    id: 'base_1',
    name: 'Codebase',
    handle: '@codebase',
    bannedWords: ['judi', 'slot'],
  };

  it('tidak membocorkan banned_words ke publik', () => {
    const result = BaseService.serializeBase(row as any);
    expect(result).not.toHaveProperty('banned_words');
  });

  it('mengirim banned_words untuk pengelola base', () => {
    const result = BaseService.serializeBase(row as any, false, { includeModeration: true });
    expect(result.banned_words).toEqual(['judi', 'slot']);
  });
});
