import { prisma } from '../config/prisma.js';
import { normalizeHandle } from '../utils/format.util.js';
import { InstagramService } from './instagram.service.js';
import { CanvasService } from './canvas.service.js';

export class FessService {
  /**
   * Get list of fesses with filters, sorting, and pagination
   */
  static async getFesses(
    params: {
      base?: string;
      status?: string;
      query?: string;
      sort?: 'newest' | 'popular';
      page?: number;
      limit?: number;
    },
    currentUserId?: string
  ) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (params.base) {
      where.baseHandle = normalizeHandle(params.base);
    }

    // Default status for public feed is 'published' unless explicitly requested
    if (params.status) {
      where.status = params.status === 'approved' ? { in: ['published', 'approved'] } : params.status;
    } else if (!params.base) {
      // General feed shows published posts
      where.status = { in: ['published', 'approved'] };
    }

    if (params.query) {
      where.content = { contains: params.query, mode: 'insensitive' };
    }

    const orderBy: any =
      params.sort === 'popular'
        ? [{ upvotes: 'desc' }, { createdAt: 'desc' }]
        : [{ createdAt: 'desc' }];

    const [total, fesses] = await Promise.all([
      prisma.fess.count({ where }),
      prisma.fess.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          comments: {
            take: 3,
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
    ]);

    // Optimize user vote query: fetch all votes by current user for these fesses in one query
    const fessIds = fesses.map((f) => f.id);
    const userVotes =
      currentUserId && fessIds.length > 0
        ? await prisma.vote.findMany({
            where: {
              userId: currentUserId,
              fessId: { in: fessIds },
            },
            select: { fessId: true, type: true },
          })
        : [];

    const voteMap = new Map(userVotes.map((v) => [v.fessId, v.type]));

    const data = fesses.map((f) => this.serializeFess(f, voteMap.get(f.id) || null));

    return {
      data,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Create a new fess (confession)
   */
  static async createFess(
    payload: {
      base_handle: string;
      content: string;
      media?: any[];
      topic?: string | null;
      scheduled_at?: string | null;
      song?: any;
      template?: string;
      quoted_fess?: any;
      tag?: string | null;
    },
    userId?: string
  ) {
    const cleanHandle = normalizeHandle(payload.base_handle);

    const base = await prisma.base.findUnique({
      where: { handle: cleanHandle },
    });

    if (!base) {
      const err: any = new Error(`Base ${payload.base_handle} tidak ditemukan`);
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const scheduledDate = payload.scheduled_at ? new Date(payload.scheduled_at) : null;
    const initialStatus = scheduledDate && scheduledDate > new Date() ? 'pending' : 'pending';

    const fess = await prisma.fess.create({
      data: {
        baseHandle: cleanHandle,
        baseId: base.id,
        userId: userId || null,
        content: payload.content.trim(),
        media: payload.media && payload.media.length > 0 ? payload.media : undefined,
        topic: payload.topic || null,
        scheduledAt: scheduledDate,
        song: payload.song || undefined,
        template: payload.template || 'default',
        quotedFess: payload.quoted_fess || undefined,
        tag: payload.tag || null,
        status: initialStatus,
      },
      include: {
        comments: true,
      },
    });

    // Update base fess count
    await prisma.base.update({
      where: { id: base.id },
      data: { fessCount: { increment: 1 } },
    });

    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { fessCount: { increment: 1 } },
      });
    }

    // Notify base creator/admin of new confession
    if (base.creatorId) {
      await prisma.notification.create({
        data: {
          userId: base.creatorId,
          type: 'moderation',
          fessId: fess.id,
          fessContent: fess.content.slice(0, 60),
          actor: 'Anonim',
          text: `Confession baru masuk antrean moderasi ${cleanHandle}`,
        },
      });
    }

    return this.serializeFess(fess, null);
  }

  /**
   * Get single fess by ID with full comments
   */
  static async getFessById(id: string, currentUserId?: string) {
    const fess = await prisma.fess.findUnique({
      where: { id },
      include: {
        comments: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    let userVote: string | null = null;
    if (currentUserId) {
      const vote = await prisma.vote.findUnique({
        where: {
          fessId_userId: {
            fessId: id,
            userId: currentUserId,
          },
        },
      });
      userVote = vote?.type || null;
    }

    return this.serializeFess(fess, userVote);
  }

  /**
   * Vote on a fess (toggle logic)
   */
  static async voteFess(id: string, type: 'up' | 'down', userId: string) {
    const fess = await prisma.fess.findUnique({ where: { id } });

    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const existingVote = await prisma.vote.findUnique({
      where: {
        fessId_userId: {
          fessId: id,
          userId,
        },
      },
    });

    let newVoteType: string | null = null;

    await prisma.$transaction(async (tx) => {
      if (existingVote) {
        if (existingVote.type === type) {
          // Toggle off: cancel existing vote
          await tx.vote.delete({ where: { id: existingVote.id } });
          await tx.fess.update({
            where: { id },
            data: {
              ...(type === 'up'
                ? { upvotes: { decrement: 1 } }
                : { downvotes: { decrement: 1 } }),
            },
          });
          newVoteType = null;
        } else {
          // Switch vote: up -> down or down -> up
          await tx.vote.update({
            where: { id: existingVote.id },
            data: { type },
          });
          await tx.fess.update({
            where: { id },
            data: {
              upvotes: type === 'up' ? { increment: 1 } : { decrement: 1 },
              downvotes: type === 'down' ? { increment: 1 } : { decrement: 1 },
            },
          });
          newVoteType = type;
        }
      } else {
        // Create new vote
        await tx.vote.create({
          data: {
            fessId: id,
            userId,
            type,
          },
        });
        await tx.fess.update({
          where: { id },
          data: {
            ...(type === 'up'
              ? { upvotes: { increment: 1 } }
              : { downvotes: { increment: 1 } }),
          },
        });
        newVoteType = type;
      }
    });

    // Notify author if upvote and author is registered
    if (newVoteType === 'up' && fess.userId && fess.userId !== userId) {
      await prisma.notification.create({
        data: {
          userId: fess.userId,
          type: 'vote',
          fessId: fess.id,
          fessContent: fess.content.slice(0, 60),
          actor: 'Anonim',
          text: 'Fess kamu mendapat upvote!',
        },
      });
    }

    const updated = await prisma.fess.findUnique({
      where: { id },
      include: { comments: true },
    });

    return this.serializeFess(updated, newVoteType);
  }

  /**
   * Approve fess (moderation)
   */
  static async approveFess(id: string, currentUser: { id: string; role: string; managedBases?: string[] }) {
    const fess = await prisma.fess.findUnique({
      where: { id },
      include: { base: true },
    });

    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const isSuperAdmin = currentUser.role === 'Super Admin';
    const isBaseAdmin = currentUser.managedBases?.includes(fess.baseHandle) || fess.base?.creatorId === currentUser.id;

    if (!isSuperAdmin && !isBaseAdmin) {
      const err: any = new Error('Anda tidak memiliki izin memoderasi fess ini');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const updated = await prisma.fess.update({
      where: { id },
      data: { status: 'published' },
      include: { comments: true },
    });

    // Auto-post trigger to social media (Instagram, Twitter, Telegram)
    try {
      await CanvasService.exportFessCanvas(id, fess.template || 'default', 'story');
    } catch {
      // Non-blocking
    }

    // Notify author
    if (fess.userId) {
      await prisma.notification.create({
        data: {
          userId: fess.userId,
          type: 'moderation',
          fessId: fess.id,
          fessContent: fess.content.slice(0, 60),
          actor: fess.baseHandle,
          text: `Fess kamu di ${fess.baseHandle} telah disetujui & dipublikasikan!`,
        },
      });
    }

    return this.serializeFess(updated, null);
  }

  /**
   * Reject fess (moderation)
   */
  static async rejectFess(id: string, currentUser: { id: string; role: string; managedBases?: string[] }) {
    const fess = await prisma.fess.findUnique({
      where: { id },
      include: { base: true },
    });

    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const isSuperAdmin = currentUser.role === 'Super Admin';
    const isBaseAdmin = currentUser.managedBases?.includes(fess.baseHandle) || fess.base?.creatorId === currentUser.id;

    if (!isSuperAdmin && !isBaseAdmin) {
      const err: any = new Error('Anda tidak memiliki izin memoderasi fess ini');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const updated = await prisma.fess.update({
      where: { id },
      data: { status: 'rejected' },
      include: { comments: true },
    });

    // Notify author
    if (fess.userId) {
      await prisma.notification.create({
        data: {
          userId: fess.userId,
          type: 'moderation',
          fessId: fess.id,
          fessContent: fess.content.slice(0, 60),
          actor: fess.baseHandle,
          text: `Fess kamu di ${fess.baseHandle} ditolak moderator`,
        },
      });
    }

    return this.serializeFess(updated, null);
  }

  /**
   * Report fess
   */
  static async reportFess(fessId: string, reason: string, note?: string | null, userId?: string) {
    const fess = await prisma.fess.findUnique({ where: { id: fessId } });
    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    await prisma.report.create({
      data: {
        fessId,
        reason,
        note: note || null,
        userId: userId || null,
      },
    });

    return { ok: true, message: 'Laporan berhasil dikirim dan akan ditinjau oleh tim moderasi.' };
  }

  /**
   * Delete fess
   */
  static async deleteFess(id: string, currentUser: { id: string; role: string; managedBases?: string[] }) {
    const fess = await prisma.fess.findUnique({ where: { id } });
    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const isAuthor = fess.userId === currentUser.id;
    const isSuperAdmin = currentUser.role === 'Super Admin';
    const isBaseAdmin = currentUser.managedBases?.includes(fess.baseHandle);

    if (!isAuthor && !isSuperAdmin && !isBaseAdmin) {
      const err: any = new Error('Anda tidak memiliki izin menghapus fess ini');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    await prisma.fess.delete({ where: { id } });

    return { ok: true };
  }

  /**
   * Get fesses posted by a specific user (My Fess)
   */
  static async getUserFesses(
    userId: string,
    params: { status?: string; page?: number; limit?: number }
  ) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (params.status) {
      where.status = params.status;
    }

    const [total, fesses] = await Promise.all([
      prisma.fess.count({ where }),
      prisma.fess.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { comments: true },
      }),
    ]);

    const data = fesses.map((f) => this.serializeFess(f, null));

    return {
      data,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Serialize Fess model into exact OpenAPI Fess schema shape
   */
  static serializeFess(fess: any, userVote: string | null = null) {
    return {
      id: fess.id,
      base_handle: fess.baseHandle,
      content: fess.content,
      created_at: new Date(fess.createdAt).getTime(),
      upvotes: fess.upvotes ?? 0,
      downvotes: fess.downvotes ?? 0,
      user_vote: userVote,
      comments_count: fess.commentsCount ?? fess.comments?.length ?? 0,
      status: fess.status,
      comments: fess.comments
        ? fess.comments.map((c: any) => ({
            id: c.id,
            author: c.author,
            text: c.text,
            created_at: new Date(c.createdAt).getTime(),
          }))
        : [],
      media: (fess.media as any) || [],
      topic: fess.topic || undefined,
      song: fess.song || undefined,
      template: fess.template || 'default',
      quoted_fess: fess.quotedFess || undefined,
      scheduled_at: fess.scheduledAt ? new Date(fess.scheduledAt).toISOString() : null,
      tag: fess.tag || undefined,
      posted_to_ig: fess.postedToIg ?? false,
    };
  }
}
