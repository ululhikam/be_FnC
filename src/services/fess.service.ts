import { prisma } from '../config/prisma.js';
import { normalizeHandle } from '../utils/format.util.js';
import { TOPICS } from '../constants/topics.js';
import { InstagramService } from './instagram.service.js';
import { CanvasService } from './canvas.service.js';
import { ModerationService } from './moderation.service.js';
import { invalidateCache } from '../utils/cache.util.js';

/** Fess counters only track publicly visible confessions. */
const PUBLISHED_STATUSES = ['published', 'approved'];

/** Comment fields rendered by the cards — avoids shipping unused columns. */
const COMMENT_PREVIEW_SELECT = {
  id: true,
  author: true,
  text: true,
  createdAt: true,
} as const;

/** Latest comments preview attached to list / vote / moderation payloads. */
const COMMENT_PREVIEW_INCLUDE = {
  comments: { take: 3, orderBy: { createdAt: 'desc' }, select: COMMENT_PREVIEW_SELECT },
} as const;

/** topic id → human label (constants are the source of truth for topics). */
const TOPIC_LABELS = new Map(TOPICS.map((t) => [t.id, t.label]));

export class FessService {
  /**
   * Get list of fesses with filters, sorting, and pagination
   */
  static async getFesses(
    params: {
      base?: string;
      status?: string;
      query?: string;
      following?: 'true' | 'false';
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

    // "Mengikuti" feed: restrict to bases followed by the signed-in user.
    if (params.following === 'true') {
      const emptyPage = { data: [], total: 0, page, limit, total_pages: 1 };
      if (!currentUserId) return emptyPage;

      const follows = await prisma.follow.findMany({
        where: { userId: currentUserId },
        select: { baseId: true },
      });
      const followedBaseIds = follows.map((f) => f.baseId);
      if (followedBaseIds.length === 0) return emptyPage;

      where.baseId = { in: followedBaseIds };
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
            select: COMMENT_PREVIEW_SELECT,
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
    const isScheduled = Boolean(scheduledDate && scheduledDate > new Date());

    // Mode "auto" pada base: fess langsung terbit, KECUALI filter NLP
    // menemukan indikasi konten negatif (ujaran kebencian, ancaman, dll.) —
    // konten seperti itu tetap masuk antrean moderasi dengan alasan flag.
    let initialStatus = 'pending';
    let autoFlagged = false;
    let flagReason: string | null = null;

    if (!isScheduled && base.postMode === 'auto') {
      const verdict = ModerationService.classify(payload.content);
      if (verdict.flagged) {
        autoFlagged = true;
        flagReason = verdict.reasons.join(', ');
      } else {
        initialStatus = 'published';
      }
    }

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
        autoFlagged,
        flagReason,
      },
    });

    // Counter hanya menghitung fess terbit: mode moderasi menaikkannya di
    // approveFess(); mode auto post menaikkannya tepat di sini karena fess
    // sudah live sejak dibuat.
    if (initialStatus === 'published') {
      await this.adjustFessCounters(fess, 1);
      invalidateCache('bases:');

      // Efek publikasi yang sama dengan approveFess (auto-post sosmed).
      try {
        await CanvasService.exportFessCanvas(fess.id, fess.template || 'default', 'story');
      } catch {
        // Non-blocking
      }
    }

    // Log audit agar admin bisa menelusuri kenapa sebuah fess tidak auto-terbit.
    if (autoFlagged) {
      await prisma.systemLog.create({
        data: {
          source: 'AI_FILTER',
          message: `Auto post ${cleanHandle} di-flag NLP (${flagReason}): "${payload.content.slice(0, 60)}"`,
          tone: 'error',
        },
      });
    }

    // Kirim fess ke base → pengirim otomatis mengikuti base tersebut.
    // Lewati jika pengirim adalah pemilik/creator base (tidak mengikuti base sendiri).
    if (userId && base.creatorId !== userId) {
      try {
        const existingFollow = await prisma.follow.findUnique({
          where: { userId_baseId: { userId, baseId: base.id } },
          select: { id: true },
        });

        if (!existingFollow) {
          await prisma.$transaction([
            prisma.follow.create({ data: { userId, baseId: base.id } }),
            prisma.base.update({
              where: { id: base.id },
              data: { membersCount: { increment: 1 } },
            }),
            prisma.user.update({
              where: { id: userId },
              data: { followingCount: { increment: 1 } },
            }),
          ]);
        }
      } catch {
        // Non-critical: fess tetap terkirim walau auto-follow gagal (mis. race).
      }
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
          text:
            initialStatus === 'published'
              ? `Confession baru terbit otomatis di ${cleanHandle}`
              : autoFlagged
                ? `Confession baru terindikasi "${flagReason}" — masuk antrean moderasi ${cleanHandle}`
                : `Confession baru masuk antrean moderasi ${cleanHandle}`,
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
          select: COMMENT_PREVIEW_SELECT,
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
  static async voteFess(id: string, type: 'up' | 'down', userId: string, actorName?: string) {
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

    // Single transaction round-trip: the mutation and the refreshed row
    // (with its comment preview) come back together — no extra SELECT.
    const updated = await prisma.$transaction(async (tx) => {
      if (existingVote) {
        if (existingVote.type === type) {
          // Toggle off: cancel existing vote
          await tx.vote.delete({ where: { id: existingVote.id } });
          newVoteType = null;
          return tx.fess.update({
            where: { id },
            data: {
              ...(type === 'up'
                ? { upvotes: { decrement: 1 } }
                : { downvotes: { decrement: 1 } }),
            },
            include: COMMENT_PREVIEW_INCLUDE,
          });
        }

        // Switch vote: up -> down or down -> up
        await tx.vote.update({
          where: { id: existingVote.id },
          data: { type },
        });
        newVoteType = type;
        return tx.fess.update({
          where: { id },
          data: {
            upvotes: type === 'up' ? { increment: 1 } : { decrement: 1 },
            downvotes: type === 'down' ? { increment: 1 } : { decrement: 1 },
          },
          include: COMMENT_PREVIEW_INCLUDE,
        });
      }

      // Create new vote
      await tx.vote.create({
        data: {
          fessId: id,
          userId,
          type,
        },
      });
      newVoteType = type;
      return tx.fess.update({
        where: { id },
        data: {
          ...(type === 'up'
            ? { upvotes: { increment: 1 } }
            : { downvotes: { increment: 1 } }),
        },
        include: COMMENT_PREVIEW_INCLUDE,
      });
    });

    // Agregasi notifikasi like ala Instagram: satu baris per fess penerima,
    // "Budi dan 3 lainnya menyukai fess kamu." — bukan satu notif per orang.
    const likeDelta = (newVoteType === 'up' ? 1 : 0) - (existingVote?.type === 'up' ? 1 : 0);
    if (likeDelta !== 0 && fess.userId && fess.userId !== userId) {
      await this.updateLikeNotification(fess, likeDelta as 1 | -1, actorName || 'Seseorang');
    }

    return this.serializeFess(updated, newVoteType);
  }

  /**
   * Bangun/perbarui notifikasi like teragregasi (satu baris per penerima+fess).
   * delta +1 saat like bertambah, -1 saat like dibatalkan (baris dihapus bila
   * tidak ada lagi yang menyukai). `actors` menyimpan daftar username sehingga
   * jumlah "dan N lainnya" selalu konsisten walau user berulang kali toggle.
   */
  private static async updateLikeNotification(
    fess: { id: string; userId?: string | null; content: string },
    delta: 1 | -1,
    actorName: string
  ) {
    if (!fess.userId) return;

    const existing = await prisma.notification.findFirst({
      where: { userId: fess.userId, fessId: fess.id, type: 'vote' },
      orderBy: { createdAt: 'desc' },
    });

    const previous = Array.isArray(existing?.actors) ? (existing!.actors as string[]) : [];

    if (delta > 0) {
      const actors = previous.includes(actorName) ? previous : [...previous, actorName];
      const count = actors.length;
      const text = count > 1 ? `dan ${count - 1} lainnya menyukai fess kamu.` : 'menyukai fess kamu.';

      if (existing) {
        // Refresh posisi ke atas + tandai belum dibaca lagi (aktivitas baru).
        await prisma.notification.update({
          where: { id: existing.id },
          data: { actor: actorName, actors, actorCount: count, text, read: false, createdAt: new Date() },
        });
      } else {
        await prisma.notification.create({
          data: {
            userId: fess.userId,
            type: 'vote',
            fessId: fess.id,
            fessContent: fess.content.slice(0, 60),
            actor: actorName,
            actors,
            actorCount: count,
            text,
          },
        });
      }
      return;
    }

    // Batal like → keluarkan aktor; hapus baris bila tidak ada sisa.
    if (!existing) return;
    const actors = previous.filter((a) => a !== actorName);
    if (actors.length === 0) {
      await prisma.notification.deleteMany({ where: { id: existing.id } });
      return;
    }

    const count = actors.length;
    await prisma.notification.update({
      where: { id: existing.id },
      data: {
        actors,
        actorCount: count,
        actor: actors[actors.length - 1],
        text: count > 1 ? `dan ${count - 1} lainnya menyukai fess kamu.` : 'menyukai fess kamu.',
      },
    });
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

    const wasPublished = PUBLISHED_STATUSES.includes(fess.status);

    const updated = await prisma.fess.update({
      where: { id },
      data: { status: 'published' },
      include: COMMENT_PREVIEW_INCLUDE,
    });

    // Counters track published fesses only — bump them on the transition.
    if (!wasPublished) {
      await this.adjustFessCounters(fess, 1);
      invalidateCache('bases:');
    }

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

    const wasPublished = PUBLISHED_STATUSES.includes(fess.status);

    const updated = await prisma.fess.update({
      where: { id },
      data: { status: 'rejected' },
      include: COMMENT_PREVIEW_INCLUDE,
    });

    // A published fess was pulled from the public feed — adjust counters.
    if (wasPublished) {
      await this.adjustFessCounters(fess, -1);
      invalidateCache('bases:');
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

    // Removing a published fess must not leave a stale published count.
    if (PUBLISHED_STATUSES.includes(fess.status)) {
      await this.adjustFessCounters(fess, -1);
      invalidateCache('bases:');
    }

    // Take down oleh admin (bukan penulis): beri tahu penulis + catat audit.
    if (!isAuthor) {
      if (fess.userId) {
        await prisma.notification.create({
          data: {
            userId: fess.userId,
            type: 'moderation',
            fessId: fess.id,
            fessContent: fess.content.slice(0, 60),
            actor: fess.baseHandle,
            text: `Fess kamu di ${fess.baseHandle} diturunkan (take down) oleh moderator.`,
          },
        });
      }

      await prisma.systemLog.create({
        data: {
          source: 'MODERATION',
          message: `Take down fess ${fess.id} dari ${fess.baseHandle} oleh ${currentUser.role} (${currentUser.id}).`,
          tone: 'info',
        },
      });
    }

    return { ok: true };
  }

  /**
   * Get fesses posted by a specific user (My Fess)
   */
  static async getUserFesses(
    userId: string,
    params: { status?: string; sort?: 'newest' | 'popular'; page?: number; limit?: number }
  ) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (params.status) {
      where.status = params.status;
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
        include: COMMENT_PREVIEW_INCLUDE,
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
   * Keep the published-fess counters in sync for a base and its author.
   * delta: +1 when a fess goes live, -1 when it stops being published.
   */
  private static async adjustFessCounters(
    fess: { baseId?: string | null; baseHandle: string; userId?: string | null },
    delta: number
  ) {
    const guard = delta < 0 ? { fessCount: { gt: 0 } } : {};
    const baseWhere = fess.baseId ? { id: fess.baseId } : { handle: fess.baseHandle };

    await prisma.base.updateMany({
      where: { ...baseWhere, ...guard },
      data: { fessCount: { increment: delta } },
    });

    if (fess.userId) {
      await prisma.user.updateMany({
        where: { id: fess.userId, ...guard },
        data: { fessCount: { increment: delta } },
      });
    }
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
      topic_label: fess.topic ? TOPIC_LABELS.get(fess.topic) || fess.topic : undefined,
      song: fess.song || undefined,
      template: fess.template || 'default',
      quoted_fess: fess.quotedFess || undefined,
      scheduled_at: fess.scheduledAt ? new Date(fess.scheduledAt).toISOString() : null,
      tag: fess.tag || undefined,
      posted_to_ig: fess.postedToIg ?? false,
      auto_flagged: fess.autoFlagged ?? false,
      flag_reason: fess.flagReason || undefined,
    };
  }
}
