import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseService } from '../src/services/base.service.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    base: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    follow: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      update: vi.fn(),
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
  });
});
