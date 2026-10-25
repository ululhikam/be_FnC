import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FessService } from '../src/services/fess.service.js';
import { InstagramService } from '../src/services/instagram.service.js';
import { CanvasService } from '../src/services/canvas.service.js';
import { CtfWalletService } from '../src/services/ctf-wallet.service.js';
import { prisma } from '../src/config/prisma.js';

// Base fixtures below exercise the free-trial posting path. Paid-base billing
// has its own dedicated tests in fess-billing.service.test.ts.
const ACTIVE_TRIAL = new Date(Date.now() + 24 * 60 * 60 * 1000);

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
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    vote: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    bookmark: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    notification: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    report: {
      create: vi.fn(),
    },
    systemLog: {
      create: vi.fn(),
    },
    platformConnection: {
      findUnique: vi.fn(),
    },
    fessCharge: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    baseRevenueEntry: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
    baseRevenueWallet: {
      upsert: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((cb) => (typeof cb === 'function' ? cb(prisma) : Promise.all(cb))),
  },
}));

vi.mock('../src/services/storage.service.js', () => ({
  StorageService: {
    uploadMedia: vi.fn().mockResolvedValue({ url: 'https://storage/canvas.svg' }),
  },
}));

vi.mock('../src/services/canvas.service.js', () => ({
  CanvasService: {
    exportFessCanvas: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../src/services/ctf-wallet.service.js', () => ({
  CtfWalletService: {
    debit: vi.fn(),
    credit: vi.fn(),
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
      vi.mocked(prisma.bookmark.findMany).mockResolvedValueOnce([
        { fessId: 'fess_1' } as any,
      ]);

      const result = await FessService.getFesses({ page: 1, limit: 10 }, 'usr_1');

      expect(result.total).toBe(1);
      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe('fess_1');
      expect(result.data[0].user_vote).toBe('up');
      expect(result.data[0].is_saved).toBe(true);
      expect(result.data[0].upvotes).toBe(10);
    });

    it('should filter fesses that have pending reports when reported=true', async () => {
      vi.mocked(prisma.fess.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.fess.findMany).mockResolvedValueOnce([
        {
          id: 'fess_reported',
          baseHandle: '@concern_fess',
          content: 'Reported confession',
          upvotes: 4,
          downvotes: 2,
          status: 'published',
          createdAt: new Date(),
          comments: [],
        } as any,
      ]);
      vi.mocked(prisma.vote.findMany).mockResolvedValueOnce([]);

      const result = await FessService.getFesses(
        { base: '@concern_fess', reported: 'true', page: 1, limit: 10 },
        'usr_mod'
      );

      expect(prisma.fess.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          baseHandle: '@concern_fess',
          reports: { some: { status: 'pending' } },
        }),
      });
      expect(result.total).toBe(1);
      expect(result.data[0].id).toBe('fess_reported');
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
        trialEndsAt: ACTIVE_TRIAL,
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
      // Fess counters track published fesses only — nothing to bump while pending.
      expect(prisma.base.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.notification.create).toHaveBeenCalled();
    });

    it('should persist carouselOrder so scheduled/approved posts keep the slide order', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codememfess',
        creatorId: 'mod_1',
        trialEndsAt: ACTIVE_TRIAL,
      } as any);

      vi.mocked(prisma.fess.create).mockResolvedValueOnce({
        id: 'fess_order',
        baseHandle: '@codememfess',
        content: 'Urutan carousel',
        status: 'pending',
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date(),
        comments: [],
        carouselOrder: ['media:media_1', 'card:0'],
      } as any);

      await FessService.createFess(
        {
          base_handle: '@codememfess',
          content: 'Urutan carousel',
          carousel_order: ['media:media_1', 'card:0'],
        },
        'usr_1'
      );

      expect(prisma.fess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            carouselOrder: ['media:media_1', 'card:0'],
          }),
        })
      );
    });

    it('should auto-follow the base when the sender does not follow it yet', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codememfess',
        creatorId: 'mod_1',
        trialEndsAt: ACTIVE_TRIAL,
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

      vi.mocked(prisma.follow.findUnique).mockResolvedValueOnce(null);

      await FessService.createFess(
        { base_handle: '@codememfess', content: 'New confession' },
        'usr_1'
      );

      expect(prisma.follow.create).toHaveBeenCalledWith({
        data: { userId: 'usr_1', baseId: 'base_1' },
      });
      expect(prisma.base.update).toHaveBeenCalledWith({
        where: { id: 'base_1' },
        data: { membersCount: { increment: 1 } },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'usr_1' },
        data: { followingCount: { increment: 1 } },
      });
    });

    it('should not auto-follow again when the sender already follows the base', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codememfess',
        creatorId: 'mod_1',
        trialEndsAt: ACTIVE_TRIAL,
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

      vi.mocked(prisma.follow.findUnique).mockResolvedValueOnce({ id: 'follow_1' } as any);

      await FessService.createFess(
        { base_handle: '@codememfess', content: 'New confession' },
        'usr_1'
      );

      expect(prisma.follow.create).not.toHaveBeenCalled();
      expect(prisma.base.update).not.toHaveBeenCalled();
    });

    it('should not auto-follow when the sender owns the base', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codememfess',
        creatorId: 'usr_1',
        trialEndsAt: ACTIVE_TRIAL,
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

      await FessService.createFess(
        { base_handle: '@codememfess', content: 'New confession' },
        'usr_1'
      );

      expect(prisma.follow.findUnique).not.toHaveBeenCalled();
      expect(prisma.follow.create).not.toHaveBeenCalled();
    });

    it('should auto-publish on mode "auto" when NLP finds no negative content', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codememfess',
        creatorId: 'mod_1',
        trialEndsAt: ACTIVE_TRIAL,
        postMode: 'auto',
      } as any);

      vi.mocked(prisma.fess.create).mockResolvedValueOnce({
        id: 'fess_new',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_1',
        content: 'Confession bersih tanpa kata kasar',
        status: 'published',
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date(),
        comments: [],
      } as any);

      vi.mocked(prisma.follow.findUnique).mockResolvedValueOnce({ id: 'follow_1' } as any);
      vi.mocked(prisma.platformConnection.findUnique).mockResolvedValueOnce(null);

      const onBackground = vi.fn();
      const fess = await FessService.createFess(
        { base_handle: '@codememfess', content: 'Confession bersih tanpa kata kasar' },
        'usr_1',
        onBackground
      );

      expect(fess.status).toBe('published');
      expect(prisma.fess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ igStatus: 'skipped' }),
        })
      );
      expect(onBackground).not.toHaveBeenCalled();
      expect(CanvasService.exportFessCanvas).not.toHaveBeenCalled();
      expect(prisma.base.updateMany).toHaveBeenCalledWith({
        where: { id: 'base_1' },
        data: { fessCount: { increment: 1 } },
      });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'usr_1' },
        data: { fessCount: { increment: 1 } },
      });
      expect(prisma.notification.create).toHaveBeenCalled();
    });

    it('keeps Instagram processing + schedules canvas only when the base has an active connection', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codememfess',
        creatorId: 'mod_1',
        trialEndsAt: ACTIVE_TRIAL,
        postMode: 'auto',
      } as any);

      vi.mocked(prisma.fess.create).mockResolvedValueOnce({
        id: 'fess_ig_connected',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_1',
        content: 'Confession dengan sosmed terhubung',
        status: 'published',
        template: 'default',
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date(),
        comments: [],
      } as any);

      vi.mocked(prisma.platformConnection.findUnique).mockResolvedValueOnce({
        connected: true,
        accessToken: 'ig_real_token',
      } as any);
      vi.mocked(prisma.follow.findUnique).mockResolvedValueOnce({ id: 'follow_1' } as any);

      const onBackground = vi.fn();
      await FessService.createFess(
        { base_handle: '@codememfess', content: 'Confession dengan sosmed terhubung' },
        'usr_1',
        onBackground
      );

      expect(prisma.fess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ igStatus: 'processing' }),
        })
      );
      expect(onBackground).toHaveBeenCalledTimes(1);
      await onBackground.mock.calls[0][0];
      expect(CanvasService.exportFessCanvas).toHaveBeenCalledWith(
        'fess_ig_connected',
        'default',
        'portrait'
      );
    });

    it('should keep fess pending + flag it when NLP detects negative content in mode "auto"', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codememfess',
        creatorId: 'mod_1',
        trialEndsAt: ACTIVE_TRIAL,
        postMode: 'auto',
      } as any);

      vi.mocked(prisma.fess.create).mockResolvedValueOnce({
        id: 'fess_new',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_1',
        content: 'dasar anjing',
        status: 'pending',
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date(),
        comments: [],
      } as any);

      vi.mocked(prisma.follow.findUnique).mockResolvedValueOnce({ id: 'follow_1' } as any);

      await FessService.createFess({ base_handle: '@codememfess', content: 'dasar anjing' }, 'usr_1');

      expect(prisma.fess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'pending',
            autoFlagged: true,
            flagReason: expect.stringContaining('ujaran kebencian'),
          }),
        })
      );
      expect(prisma.base.updateMany).not.toHaveBeenCalled();
      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ source: 'AI_FILTER' }) })
      );
    });

    it('charges one CTF on a paid base and returns the new balance', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
        id: 'base_1',
        handle: '@codememfess',
        creatorId: 'mod_1',
        freeForever: false,
        trialEndsAt: new Date(Date.now() - 1000),
      } as any);
      vi.mocked(prisma.fess.create).mockResolvedValueOnce({
        id: 'fess_paid',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_1',
        content: 'Paid confession',
        status: 'pending',
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date(),
        comments: [],
      } as any);
      vi.mocked(prisma.fessCharge.findUnique).mockResolvedValueOnce(null);
      vi.mocked(CtfWalletService.debit).mockResolvedValueOnce({
        walletId: 'wallet_1',
        balance: 4,
        idempotent: false,
      } as any);
      vi.mocked(prisma.fessCharge.create).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.follow.findUnique).mockResolvedValueOnce({ id: 'follow_1' } as any);

      const result = await FessService.createFess(
        { base_handle: '@codememfess', content: 'Paid confession' },
        { id: 'usr_1', emailVerifiedAt: new Date() }
      );

      expect(result).toMatchObject({
        id: 'fess_paid',
        status: 'pending',
        charged_ctf: 1,
        ctf_balance: 4,
        base_billing: { requires_payment: true, reason: 'paid' },
      });
      expect(CtfWalletService.debit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'usr_1',
          amount: 1,
          type: 'FESS_CHARGE',
          referenceId: 'fess_paid',
        }),
        prisma
      );
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        maxWait: 10_000,
        timeout: 30_000,
      });
    });

    it('rejects a paid fess without a verified email or enough CTF', async () => {
      vi.mocked(prisma.base.findUnique).mockResolvedValue({
        id: 'base_1',
        handle: '@codememfess',
        creatorId: 'mod_1',
        trialEndsAt: new Date(Date.now() - 1000),
      } as any);

      await expect(
        FessService.createFess(
          { base_handle: '@codememfess', content: 'No email' },
          'usr_1'
        )
      ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED', status: 403 });

      vi.mocked(prisma.fess.create).mockResolvedValueOnce({
        id: 'fess_paid',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_1',
        content: 'Poor wallet',
        status: 'pending',
        comments: [],
      } as any);
      vi.mocked(prisma.fessCharge.findUnique).mockResolvedValueOnce(null);
      vi.mocked(CtfWalletService.debit).mockRejectedValueOnce(
        Object.assign(new Error('Saldo CTF tidak mencukupi'), {
          status: 402,
          code: 'INSUFFICIENT_CTF',
        })
      );

      await expect(
        FessService.createFess(
          { base_handle: '@codememfess', content: 'Poor wallet' },
          { id: 'usr_1', emailVerifiedAt: new Date() }
        )
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_CTF', status: 402 });
    });

    it('replays an idempotent fess creation without charging again', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_existing',
        baseHandle: '@codememfess',
        userId: 'usr_1',
        content: 'Same request',
        status: 'pending',
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date(),
        comments: [],
        base: { avatar: null, color: '#123', initial: 'CM' },
      } as any);

      const result = await FessService.createFess(
        {
          base_handle: '@codememfess',
          content: 'Same request',
          idempotency_key: 'fess-key-1',
        },
        { id: 'usr_1', emailVerifiedAt: new Date() }
      );

      expect(result.id).toBe('fess_existing');
      expect(prisma.base.findUnique).not.toHaveBeenCalled();
      expect(prisma.fess.create).not.toHaveBeenCalled();
      expect(CtfWalletService.debit).not.toHaveBeenCalled();
    });
  });

  describe('getUserFesses', () => {
    it('should sort by popular (upvotes) when requested', async () => {
      vi.mocked(prisma.fess.count).mockResolvedValueOnce(0);
      vi.mocked(prisma.fess.findMany).mockResolvedValueOnce([]);

      await FessService.getUserFesses('usr_1', { sort: 'popular', page: 1, limit: 10 });

      expect(prisma.fess.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ upvotes: 'desc' }, { createdAt: 'desc' }],
        })
      );
    });

    it('should filter by status when provided', async () => {
      vi.mocked(prisma.fess.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.fess.findMany).mockResolvedValueOnce([
        {
          id: 'fess_1',
          baseHandle: '@codememfess',
          content: 'Pending one',
          upvotes: 0,
          downvotes: 0,
          status: 'pending',
          createdAt: new Date(),
          comments: [],
        } as any,
      ]);

      const result = await FessService.getUserFesses('usr_1', { status: 'pending' });

      expect(prisma.fess.count).toHaveBeenCalledWith({ where: { userId: 'usr_1', status: 'pending' } });
      expect(result.total).toBe(1);
      expect(result.data[0].status).toBe('pending');
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

    it('should create ONE aggregated like notification on first upvote', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_1',
        userId: 'usr_author',
        content: 'Content',
        upvotes: 0,
        downvotes: 0,
      } as any);

      vi.mocked(prisma.vote.findUnique).mockResolvedValueOnce(null);

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

      await FessService.voteFess('fess_1', 'up', 'usr_1', 'Budi');

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'vote',
          actor: 'Budi',
          actorCount: 1,
          actors: ['Budi'],
          text: 'menyukai fess kamu.',
        }),
      });
    });

    it('should aggregate into "dan N lainnya" when the fess already has likers', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_1',
        userId: 'usr_author',
        content: 'Content',
        upvotes: 1,
        downvotes: 0,
      } as any);

      vi.mocked(prisma.vote.findUnique).mockResolvedValueOnce(null);

      vi.mocked(prisma.fess.update).mockResolvedValueOnce({
        id: 'fess_1',
        baseHandle: '@codememfess',
        content: 'Content',
        upvotes: 2,
        downvotes: 0,
        status: 'published',
        createdAt: new Date(),
        comments: [],
      } as any);

      vi.mocked(prisma.notification.findFirst).mockResolvedValueOnce({
        id: 'notif_1',
        actors: ['Budi'],
        actorCount: 1,
      } as any);

      await FessService.voteFess('fess_1', 'up', 'usr_2', 'Rani');

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif_1' },
        data: expect.objectContaining({
          actor: 'Rani',
          actorCount: 2,
          actors: ['Budi', 'Rani'],
          text: 'dan 1 lainnya menyukai fess kamu.',
          read: false,
        }),
      });
    });

    it('should delete the like notification when the last liker unlikes', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_1',
        userId: 'usr_author',
        content: 'Content',
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

      vi.mocked(prisma.notification.findFirst).mockResolvedValueOnce({
        id: 'notif_1',
        actors: ['Budi'],
        actorCount: 1,
      } as any);

      await FessService.voteFess('fess_1', 'up', 'usr_1', 'Budi');

      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({ where: { id: 'notif_1' } });
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

    it('should deny Super Admin from approving a fess for another base', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_1',
        baseHandle: '@codememfess',
        base: { creatorId: 'mod_owner' },
      } as any);

      await expect(
        FessService.approveFess('fess_1', {
          id: 'superadmin_1',
          role: 'Super Admin',
          managedBases: ['@codememfess'],
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
      vi.mocked(prisma.platformConnection.findUnique).mockResolvedValueOnce(null);

      const onBackground = vi.fn();
      const approved = await FessService.approveFess(
        'fess_1',
        {
          id: 'mod_owner',
          role: 'Base Admin',
          managedBases: ['@codememfess'],
        },
        onBackground
      );

      expect(approved.status).toBe('published');
      expect(prisma.fess.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ igStatus: 'skipped', igError: null }),
        })
      );
      expect(onBackground).not.toHaveBeenCalled();
      expect(CanvasService.exportFessCanvas).not.toHaveBeenCalled();
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

    it('tidak menyetel processing saat approve ulang fess yang sudah pernah terbit ke IG', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_ig',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_author',
        status: 'rejected',
        postedToIg: true,
        template: 'default',
        content: 'Sudah pernah terbit ke IG',
        base: { creatorId: 'mod_owner' },
      } as any);

      vi.mocked(prisma.fess.update).mockResolvedValueOnce({
        id: 'fess_ig',
        baseHandle: '@codememfess',
        content: 'Sudah pernah terbit ke IG',
        status: 'published',
        postedToIg: true,
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date(),
        comments: [],
      } as any);

      await FessService.approveFess('fess_ig', {
        id: 'mod_owner',
        role: 'Base Admin',
        managedBases: ['@codememfess'],
      });

      expect(prisma.fess.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'published', igStatus: 'published' }),
        })
      );
    });

    it('does not republish a fess whose CTF charge was already refunded', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_refunded',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_author',
        status: 'rejected',
        content: 'Refunded',
        base: { creatorId: 'mod_owner' },
        charge: { id: 'charge_1', status: 'REFUNDED', amount: 1 },
      } as any);

      await expect(
        FessService.approveFess('fess_refunded', {
          id: 'mod_owner',
          role: 'Base Admin',
          managedBases: ['@codememfess'],
        })
      ).rejects.toMatchObject({ code: 'FESS_CHARGE_REFUNDED', status: 409 });

      expect(prisma.fess.update).not.toHaveBeenCalled();
    });

    it('refunds one CTF when a paid fess is rejected before publishing', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_pending',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_author',
        status: 'pending',
        content: 'Pending paid',
        base: { creatorId: 'mod_owner' },
        charge: { id: 'charge_1', status: 'CHARGED', amount: 1 },
      } as any);
      vi.mocked(prisma.fess.update).mockResolvedValueOnce({
        id: 'fess_pending',
        baseHandle: '@codememfess',
        content: 'Pending paid',
        status: 'rejected',
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date(),
        comments: [],
      } as any);
      vi.mocked(prisma.fessCharge.findUnique).mockResolvedValueOnce({
        id: 'charge_1',
        userId: 'usr_author',
        amount: 1,
        status: 'CHARGED',
      } as any);
      vi.mocked(CtfWalletService.credit).mockResolvedValueOnce({
        walletId: 'wallet_1',
        balance: 5,
        idempotent: false,
      } as any);
      vi.mocked(prisma.fessCharge.update).mockResolvedValueOnce({} as any);

      const result = await FessService.rejectFess('fess_pending', {
        id: 'mod_owner',
        role: 'Base Admin',
        managedBases: ['@codememfess'],
      });

      expect(result).toMatchObject({ status: 'rejected', refunded_ctf: 1, ctf_balance: 5 });
      expect(CtfWalletService.credit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'usr_author',
          amount: 1,
          type: 'FESS_REFUND',
          referenceId: 'fess_pending',
        }),
        prisma
      );
      expect(prisma.baseRevenueEntry.updateMany).not.toHaveBeenCalled();
    });

    it('does not refund CTF but reverses base revenue after a published fess is rejected', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_live',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_author',
        status: 'published',
        content: 'Live paid',
        base: { creatorId: 'mod_owner' },
        charge: { id: 'charge_1', status: 'CHARGED', amount: 1 },
      } as any);
      vi.mocked(prisma.fess.update).mockResolvedValueOnce({
        id: 'fess_live',
        baseHandle: '@codememfess',
        content: 'Live paid',
        status: 'rejected',
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date(),
        comments: [],
      } as any);
      vi.mocked(prisma.baseRevenueEntry.findUnique).mockResolvedValueOnce({
        id: 'entry_1',
        walletId: 'wallet_rev',
        amountIdr: 80,
        status: 'PENDING',
        type: 'EARNING',
      } as any);
      vi.mocked(prisma.baseRevenueEntry.updateMany).mockResolvedValueOnce({ count: 1 } as any);
      vi.mocked(prisma.baseRevenueWallet.update).mockResolvedValueOnce({} as any);

      const result = await FessService.rejectFess('fess_live', {
        id: 'mod_owner',
        role: 'Base Admin',
        managedBases: ['@codememfess'],
      });

      expect(result.revenue_reversal).toEqual({ amount_idr: 80, status: 'REVERSED' });
      expect(CtfWalletService.credit).not.toHaveBeenCalled();
      expect(prisma.baseRevenueWallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet_rev' },
        data: {
          pendingIdr: { decrement: 80 },
          lifetimeIdr: { decrement: 80 },
        },
      });
    });

    it('does not refund CTF when a previously published fess is rejected again', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_was_live',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_author',
        status: 'rejected',
        publishedAt: new Date('2026-10-20T00:00:00Z'),
        content: 'Pernah terbit',
        base: { creatorId: 'mod_owner' },
        charge: { id: 'charge_1', status: 'CHARGED', amount: 1 },
      } as any);
      vi.mocked(prisma.fess.update).mockResolvedValueOnce({
        id: 'fess_was_live',
        baseHandle: '@codememfess',
        content: 'Pernah terbit',
        status: 'rejected',
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date(),
        comments: [],
      } as any);
      vi.mocked(prisma.baseRevenueEntry.findUnique).mockResolvedValueOnce({
        id: 'entry_1',
        walletId: 'wallet_rev',
        amountIdr: 80,
        status: 'REVERSED',
        type: 'EARNING',
      } as any);

      const result = await FessService.rejectFess('fess_was_live', {
        id: 'mod_owner',
        role: 'Base Admin',
        managedBases: ['@codememfess'],
      });

      expect(result.refunded_ctf).toBeUndefined();
      expect(CtfWalletService.credit).not.toHaveBeenCalled();
      expect(prisma.fessCharge.update).not.toHaveBeenCalled();
      expect(prisma.baseRevenueEntry.updateMany).not.toHaveBeenCalled();
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

  describe('bookmarkFess', () => {
    it('should save a fess idempotently for the signed-in user', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({ id: 'fess_1' } as any);

      const result = await FessService.bookmarkFess('fess_1', 'usr_1');

      expect(result).toEqual({ saved: true });
      expect(prisma.bookmark.upsert).toHaveBeenCalledWith({
        where: { fessId_userId: { fessId: 'fess_1', userId: 'usr_1' } },
        create: { fessId: 'fess_1', userId: 'usr_1' },
        update: {},
      });
    });

    it('should reject bookmarking a missing fess', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce(null);

      await expect(FessService.bookmarkFess('missing', 'usr_1')).rejects.toMatchObject({
        status: 404,
        code: 'NOT_FOUND',
      });
    });

    it('should remove a bookmark idempotently', async () => {
      const result = await FessService.unbookmarkFess('fess_1', 'usr_1');

      expect(result).toEqual({ saved: false });
      expect(prisma.bookmark.deleteMany).toHaveBeenCalledWith({
        where: { fessId: 'fess_1', userId: 'usr_1' },
      });
    });

    it('should list saved fesses with is_saved and user_vote attached', async () => {
      vi.mocked(prisma.bookmark.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.bookmark.findMany).mockResolvedValueOnce([
        {
          fess: {
            id: 'fess_saved',
            baseHandle: '@codememfess',
            content: 'Fess tersimpan',
            status: 'published',
            upvotes: 3,
            downvotes: 0,
            createdAt: new Date(),
            comments: [],
          },
        },
      ] as any);
      vi.mocked(prisma.vote.findMany).mockResolvedValueOnce([
        { fessId: 'fess_saved', type: 'up' } as any,
      ]);

      const result = await FessService.getBookmarkedFesses('usr_1', {
        page: 1,
        limit: 10,
      });

      expect(result.total).toBe(1);
      expect(result.data[0].id).toBe('fess_saved');
      expect(result.data[0].is_saved).toBe(true);
      expect(result.data[0].user_vote).toBe('up');
    });
  });

  describe('deleteFess (take down oleh admin)', () => {
    it('should delete the Instagram post too when a media id is stored', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_ig',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_author',
        content: 'Fess yang sudah tayang di IG',
        status: 'published',
        postedToIg: true,
        igMediaId: 'ig_media_1',
      } as any);
      const deleteIg = vi
        .spyOn(InstagramService, 'deletePublishedPost')
        .mockResolvedValueOnce({ ok: true });

      const result = await FessService.deleteFess('fess_ig', {
        id: 'mod_1',
        role: 'Base Admin',
        managedBases: ['@codememfess'],
      });

      expect(result.instagram).toEqual({ status: 'deleted' });
      expect(deleteIg).toHaveBeenCalledWith('ig_media_1', '@codememfess');
      deleteIg.mockRestore();
    });

    it('should remove fess, adjust counters, notify author, and log the take down', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_1',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_author',
        content: 'Konten melanggar',
        status: 'published',
      } as any);

      const result = await FessService.deleteFess('fess_1', {
        id: 'mod_1',
        role: 'Base Admin',
        managedBases: ['@codememfess'],
      });

      expect(result.ok).toBe(true);
      expect(prisma.fess.delete).toHaveBeenCalledWith({ where: { id: 'fess_1' } });
      expect(prisma.base.updateMany).toHaveBeenCalledWith({
        where: { id: 'base_1', fessCount: { gt: 0 } },
        data: { fessCount: { increment: -1 } },
      });
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'usr_author',
            type: 'moderation',
            text: expect.stringContaining('take down'),
          }),
        })
      );
      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ source: 'MODERATION' }) })
      );
    });

    it('should NOT notify nor log when the author deletes their own fess', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_1',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_author',
        content: 'Konten sendiri',
        status: 'published',
      } as any);

      await FessService.deleteFess('fess_1', {
        id: 'usr_author',
        role: 'User',
        managedBases: [],
      });

      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(prisma.systemLog.create).not.toHaveBeenCalled();
    });

    it('does not refund CTF when a previously published but now rejected fess is deleted', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_was_live',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_author',
        content: 'Pernah terbit',
        status: 'rejected',
        publishedAt: new Date('2026-10-20T00:00:00Z'),
        base: { creatorId: 'mod_owner' },
        charge: { id: 'charge_1', status: 'CHARGED', amount: 1 },
      } as any);
      vi.mocked(prisma.baseRevenueEntry.findUnique).mockResolvedValueOnce({
        id: 'entry_1',
        walletId: 'wallet_rev',
        amountIdr: 80,
        status: 'REVERSED',
        type: 'EARNING',
      } as any);

      const result = await FessService.deleteFess('fess_was_live', {
        id: 'mod_owner',
        role: 'Base Admin',
        managedBases: ['@codememfess'],
      });

      expect(result.refunded_ctf).toBeUndefined();
      expect(result.revenue_reversal).toBeUndefined();
      expect(CtfWalletService.credit).not.toHaveBeenCalled();
      expect(prisma.fessCharge.update).not.toHaveBeenCalled();
    });

    it('should deny Super Admin from deleting a fess even if listed in managed bases', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_was_live',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_author',
        content: 'Pernah terbit',
        status: 'rejected',
        publishedAt: new Date('2026-10-20T00:00:00Z'),
        base: { creatorId: 'mod_owner' },
        charge: { id: 'charge_1', status: 'CHARGED', amount: 1 },
      } as any);

      await expect(
        FessService.deleteFess('fess_was_live', {
          id: 'superadmin_1',
          role: 'Super Admin',
          managedBases: ['@codememfess'],
        })
      ).rejects.toThrow('tidak memiliki izin');
    });

    it('refunds CTF when a never-published paid fess is deleted', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_pending',
        baseHandle: '@codememfess',
        baseId: 'base_1',
        userId: 'usr_author',
        content: 'Belum terbit',
        status: 'pending',
        publishedAt: null,
        base: { creatorId: 'mod_owner' },
        charge: { id: 'charge_1', status: 'CHARGED', amount: 1 },
      } as any);
      vi.mocked(prisma.fessCharge.findUnique).mockResolvedValueOnce({
        id: 'charge_1',
        userId: 'usr_author',
        amount: 1,
        status: 'CHARGED',
      } as any);
      vi.mocked(CtfWalletService.credit).mockResolvedValueOnce({
        walletId: 'wallet_1',
        balance: 5,
        idempotent: false,
      } as any);
      vi.mocked(prisma.fessCharge.update).mockResolvedValueOnce({} as any);

      const result = await FessService.deleteFess('fess_pending', {
        id: 'usr_author',
        role: 'User',
        managedBases: [],
      });

      expect(result).toMatchObject({ ok: true, refunded_ctf: 1, ctf_balance: 5 });
      expect(CtfWalletService.credit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'usr_author',
          amount: 1,
          type: 'FESS_REFUND',
          referenceId: 'fess_pending',
        }),
        prisma
      );
      expect(prisma.baseRevenueEntry.updateMany).not.toHaveBeenCalled();
    });
  });
});

describe('Serialisasi status Instagram', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const fess = {
    id: 'fess_ig_1',
    baseHandle: '@codemine',
    content: 'Fess dengan status IG',
    createdAt: new Date(),
    status: 'published',
    igStatus: 'failed',
    igError: 'Container media Meta ERROR: rasio tidak sama',
    igAttempts: 2,
    postedToIg: false,
  };

  it('publik hanya melihat status, detail error disembunyikan', () => {
    const data = FessService.serializeFess(fess);
    expect(data.ig_status).toBe('failed');
    expect(data.ig_attempts).toBe(2);
    expect(data).not.toHaveProperty('ig_error');
  });

  it('admin pengelola base melihat detail error untuk ditindaklanjuti', () => {
    const data = FessService.serializeFess(fess, null, { includeIgError: true });
    expect(data.ig_status).toBe('failed');
    expect(data.ig_error).toContain('rasio tidak sama');
  });

  it('flag can_manage_instagram dihitung per viewer dan tidak bocor ke publik', () => {
    expect(FessService.serializeFess(fess)).not.toHaveProperty('can_manage_instagram');

    const owner = FessService.serializeFess(fess, null, { canManageInstagram: true });
    expect(owner.can_manage_instagram).toBe(true);

    const other = FessService.serializeFess(fess, null, { canManageInstagram: false });
    expect(other.can_manage_instagram).toBe(false);
  });

  it('menyertakan is_saved hanya sesuai state user yang meminta', () => {
    expect(FessService.serializeFess(fess).is_saved).toBe(false);
    expect(FessService.serializeFess(fess, null, { isSaved: true }).is_saved).toBe(true);
  });

  it('getFesses: admin base lain tidak mendapat izin maupun detail error IG', async () => {
    const row = {
      ...fess,
      comments: [],
      base: { creatorId: 'usr_owner' },
    };

    vi.mocked(prisma.fess.count).mockResolvedValueOnce(1);
    vi.mocked(prisma.fess.findMany).mockResolvedValueOnce([row] as any);

    const otherView = await FessService.getFesses(
      { page: 1, limit: 10, query: 'status' },
      undefined,
      { id: 'usr_other', role: 'Base Admin', managedBases: ['@base_lain'] }
    );
    expect(otherView.data[0].can_manage_instagram).toBe(false);
    expect(otherView.data[0]).not.toHaveProperty('ig_error');

    vi.mocked(prisma.fess.count).mockResolvedValueOnce(1);
    vi.mocked(prisma.fess.findMany).mockResolvedValueOnce([row] as any);

    const ownerView = await FessService.getFesses(
      { page: 1, limit: 10, query: 'status' },
      undefined,
      { id: 'usr_owner', role: 'Base Admin', managedBases: [] }
    );
    expect(ownerView.data[0].can_manage_instagram).toBe(true);
    expect(ownerView.data[0].ig_error).toContain('rasio tidak sama');
  });

  it('assertCanManageFess menolak admin base lain & fess duplikat', async () => {
    const row = {
      baseHandle: '@codemine',
      status: 'published',
      postedToIg: false,
      base: { creatorId: 'usr_owner' },
    };

    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce(row as any);
    await expect(
      FessService.assertCanManageFess('fess_ig_1', {
        id: 'usr_other',
        role: 'Base Admin',
        managedBases: ['@base_lain'],
      })
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({ ...row, postedToIg: true } as any);
    await expect(
      FessService.assertCanManageFess('fess_ig_1', {
        id: 'usr_owner',
        role: 'Base Admin',
        managedBases: ['@codemine'],
      })
    ).rejects.toMatchObject({ status: 409, code: 'FESS_ALREADY_POSTED' });
  });

  it('getFessById: pemilik base melihat detail, admin base lain tidak', async () => {
    const row = {
      ...fess,
      comments: [],
      base: { avatar: null, color: '#123', initial: 'CM', creatorId: 'usr_owner' },
    };

    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce(row as any);
    const ownerView = await FessService.getFessById('fess_ig_1', undefined, {
      id: 'usr_owner',
      role: 'Base Admin',
      managedBases: [],
    });
    expect(ownerView.ig_error).toContain('rasio tidak sama');
    expect(ownerView.can_manage_instagram).toBe(true);

    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce(row as any);
    const otherView = await FessService.getFessById('fess_ig_1', undefined, {
      id: 'usr_other',
      role: 'Base Admin',
      managedBases: ['@base_lain'],
    });
    expect(otherView).not.toHaveProperty('ig_error');
    expect(otherView.can_manage_instagram).toBe(false);
  });

  it('getInstagramStatus: polling publik hanya status, admin pengelola dapat detail', async () => {
    const row = {
      id: 'fess_ig_1',
      baseHandle: '@codemine',
      postedToIg: false,
      igStatus: 'failed',
      igError: 'Container media Meta ERROR: rasio tidak sama',
      igAttempts: 3,
      igUpdatedAt: new Date(),
      base: { creatorId: 'usr_owner' },
    };

    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce(row as any);
    const publicView = await FessService.getInstagramStatus('fess_ig_1');
    expect(publicView).toMatchObject({
      id: 'fess_ig_1',
      posted_to_ig: false,
      ig_status: 'failed',
      ig_attempts: 3,
    });
    expect(publicView).not.toHaveProperty('ig_error');
    expect(publicView.can_manage_instagram).toBe(false);

    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce(row as any);
    const ownerView = await FessService.getInstagramStatus('fess_ig_1', {
      id: 'usr_owner',
      role: 'Base Admin',
      managedBases: [],
    });
    expect(ownerView.ig_error).toContain('rasio tidak sama');
    expect(ownerView.can_manage_instagram).toBe(true);
  });
});
