import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FessService } from '../src/services/fess.service.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    fess: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    base: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    follow: {
      findMany: vi.fn(),
    },
    vote: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    report: {
      create: vi.fn(),
    },
    systemLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn((cb) => (typeof cb === 'function' ? cb(prisma) : Promise.all(cb))),
  },
}));

vi.mock('../src/services/storage.service.js', () => ({
  StorageService: {
    uploadMedia: vi.fn().mockResolvedValue({ url: 'https://storage/canvas.svg' }),
  },
}));

describe('FessService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getFesses', () => {
    it('should return paginated confessions and attach user_vote correctly', async () => {
      vi.mocked(prisma.fess.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.fess.findMany).mockResolvedValueOnce([
        {
          id: 'fess_1',
          baseHandle: '@codememfess',
          content: 'Hello world confession',
          upvotes: 10,
          downvotes: 1,
          status: 'published',
          createdAt: new Date(),
          comments: [],
        } as any,
      ]);
      vi.mocked(prisma.vote.findMany).mockResolvedValueOnce([
        { fessId: 'fess_1', type: 'up' } as any,
      ]);

      const result = await FessService.getFesses({ page: 1, limit: 10 }, 'usr_1');

      expect(result.total).toBe(1);
      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe('fess_1');
      expect(result.data[0].user_vote).toBe('up');
      expect(result.data[0].upvotes).toBe(10);
    });

    it('should restrict to followed bases when following=true', async () => {
      vi.mocked(prisma.follow.findMany).mockResolvedValueOnce([{ baseId: 'base_1' }] as any);
      vi.mocked(prisma.fess.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.fess.findMany).mockResolvedValueOnce([
        {
          id: 'fess_2',
          baseHandle: '@codememfess',
          baseId: 'base_1',
          content: 'From a followed base',
          upvotes: 2,
          downvotes: 0,
          status: 'published',
          createdAt: new Date(),
          comments: [],
        } as any,
      ]);
      vi.mocked(prisma.vote.findMany).mockResolvedValueOnce([]);

      const result = await FessService.getFesses(
        { following: 'true', page: 1, limit: 10 },
        'usr_1'
      );

      expect(prisma.follow.findMany).toHaveBeenCalledWith({
        where: { userId: 'usr_1' },
        select: { baseId: true },
      });
      expect(prisma.fess.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ baseId: { in: ['base_1'] } }),
        })
      );
      expect(result.total).toBe(1);
      expect(result.data[0].id).toBe('fess_2');
    });

    it('should return an empty page when following=true without followed bases', async () => {
      vi.mocked(prisma.follow.findMany).mockResolvedValueOnce([]);

      const result = await FessService.getFesses({ following: 'true' }, 'usr_1');

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20, total_pages: 1 });
      expect(prisma.fess.findMany).not.toHaveBeenCalled();
    });
  });

  describe('createFess', () => {
    it('should throw error if base does not exist', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce(null);

      await expect(
        FessService.createFess({
          base_handle: '@unknownbase',
          content: 'Confession text',
        })
      ).rejects.toThrow('tidak ditemukan');
    });

    it('should create fess with pending status without touching published counters', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codememfess',
        creatorId: 'mod_1',
      } as any);

      vi.mocked(prisma.fess.create).mockResolvedValueOnce({
        id: 'fess_new',
        baseHandle: '@codememfess',
        content: 'New confession',
        status: 'pending',
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date(),
        comments: [],
      } as any);

      const fess = await FessService.createFess(
        {
          base_handle: '@codememfess',
          content: 'New confession',
        },
        'usr_1'
      );

      expect(fess.id).toBe('fess_new');
      expect(fess.status).toBe('pending');
      // Counters track published fesses only — nothing to bump while pending.
      expect(prisma.base.update).not.toHaveBeenCalled();
      expect(prisma.base.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.notification.create).toHaveBeenCalled();
    });
  });

  describe('voteFess toggle logic', () => {
    it('should add upvote when user has not voted yet', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_1',
        upvotes: 0,
        downvotes: 0,
      } as any);

      vi.mocked(prisma.vote.findUnique).mockResolvedValueOnce(null);

      // The transaction returns the refreshed row (no follow-up SELECT).
      vi.mocked(prisma.fess.update).mockResolvedValueOnce({
        id: 'fess_1',
        baseHandle: '@codememfess',
        content: 'Content',
        upvotes: 1,
        downvotes: 0,
        status: 'published',
        createdAt: new Date(),
        comments: [],
      } as any);

      const result = await FessService.voteFess('fess_1', 'up', 'usr_1');

      expect(prisma.vote.create).toHaveBeenCalled();
      expect(result.user_vote).toBe('up');
      expect(result.upvotes).toBe(1);
    });

    it('should remove vote when user votes same type again (toggle off)', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_1',
        upvotes: 1,
        downvotes: 0,
      } as any);

      vi.mocked(prisma.vote.findUnique).mockResolvedValueOnce({
        id: 'vote_1',
        fessId: 'fess_1',
        userId: 'usr_1',
        type: 'up',
      } as any);

      vi.mocked(prisma.fess.update).mockResolvedValueOnce({
        id: 'fess_1',
        baseHandle: '@codememfess',
        content: 'Content',
        upvotes: 0,
        downvotes: 0,
        status: 'published',
        createdAt: new Date(),
        comments: [],
      } as any);

      const result = await FessService.voteFess('fess_1', 'up', 'usr_1');

      expect(prisma.vote.delete).toHaveBeenCalled();
      expect(result.user_vote).toBe(null);
    });

    it('should switch vote when user votes opposite type', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_1',
        upvotes: 1,
        downvotes: 0,
      } as any);

      vi.mocked(prisma.vote.findUnique).mockResolvedValueOnce({
        id: 'vote_1',
        fessId: 'fess_1',
        userId: 'usr_1',
        type: 'up',
      } as any);

      vi.mocked(prisma.fess.update).mockResolvedValueOnce({
        id: 'fess_1',
        baseHandle: '@codememfess',
        content: 'Content',
        upvotes: 0,
        downvotes: 1,
        status: 'published',
        createdAt: new Date(),
        comments: [],
      } as any);

      const result = await FessService.voteFess('fess_1', 'down', 'usr_1');

      expect(prisma.vote.update).toHaveBeenCalled();
      expect(result.user_vote).toBe('down');
    });
  });

  describe('moderation: approveFess & rejectFess', () => {
    it('should prevent non-admin from approving fess', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_1',
        baseHandle: '@codememfess',
        base: { creatorId: 'mod_owner' },
      } as any);

      await expect(
        FessService.approveFess('fess_1', {
          id: 'unauthorized_user',
          role: 'User',
          managedBases: [],
        })
      ).rejects.toThrow('tidak memiliki izin');
    });

    it('should bump published counters when a pending fess is approved', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_1',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_author',
        status: 'pending',
        template: 'default',
        content: 'Content',
        base: { creatorId: 'mod_owner' },
      } as any);

      vi.mocked(prisma.fess.update).mockResolvedValueOnce({
        id: 'fess_1',
        baseHandle: '@codememfess',
        content: 'Content',
        status: 'published',
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date(),
        comments: [],
      } as any);

      const approved = await FessService.approveFess('fess_1', {
        id: 'mod_owner',
        role: 'Base Admin',
        managedBases: ['@codememfess'],
      });

      expect(approved.status).toBe('published');
      expect(prisma.base.updateMany).toHaveBeenCalledWith({
        where: { id: 'base_1' },
        data: { fessCount: { increment: 1 } },
      });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'usr_author' },
        data: { fessCount: { increment: 1 } },
      });
    });

    it('should not double-count when approving an already published fess', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_1',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_author',
        status: 'published',
        template: 'default',
        content: 'Content',
        base: { creatorId: 'mod_owner' },
      } as any);

      vi.mocked(prisma.fess.update).mockResolvedValueOnce({
        id: 'fess_1',
        baseHandle: '@codememfess',
        content: 'Content',
        status: 'published',
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date(),
        comments: [],
      } as any);

      await FessService.approveFess('fess_1', {
        id: 'mod_owner',
        role: 'Base Admin',
        managedBases: ['@codememfess'],
      });

      expect(prisma.base.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('reportFess', () => {
    it('should record report for fess', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({ id: 'fess_1' } as any);

      const result = await FessService.reportFess('fess_1', 'spam', 'Spam link', 'usr_reporter');
      expect(prisma.report.create).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });
  });
});
