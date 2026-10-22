import { prisma } from '../config/prisma.js';
import { normalizeHandle } from '../utils/format.util.js';
import { TOPICS } from '../constants/topics.js';
import { InstagramService } from './instagram.service.js';
import { ModerationService } from './moderation.service.js';
import { invalidateCache, getOrSet } from '../utils/cache.util.js';

/** Fess counters only track publicly visible confessions. */
const PUBLISHED_STATUSES = ['published', 'approved'];

/** Comment fields rendered by the cards — avoids shipping unused columns. */
const COMMENT_PREVIEW_SELECT = {
  id: true,
  author: true,
  text: true,
  createdAt: true,
} as const;

/** Identitas visual base yang dipakai kartu fess (foto profil / warna / inisial). */
const BASE_PREVIEW_SELECT = {
  avatar: true,
  color: true,
  initial: true,
  creatorId: true,
} as const;

/** Latest comments preview attached to list / vote / moderation payloads. */
const COMMENT_PREVIEW_INCLUDE = {
  comments: { take: 3, orderBy: { createdAt: 'desc' }, select: COMMENT_PREVIEW_SELECT },
  base: { select: BASE_PREVIEW_SELECT },
} as const;

/** topic id → human label (constants are the source of truth for topics). */
const TOPIC_LABELS = new Map(TOPICS.map((t) => [t.id, t.label]));

/**
 * Renderer kartu memuat resvg/sharp/opentype yang berat. Import dinamis
 * menjaga jalur baca (feed/detail) tetap ringan saat cold start.
 */
async function exportFessCanvasForAutoPost(fessId: string, template?: string | null) {
  const { CanvasService } = await import('./canvas.service.js');
  return CanvasService.exportFessCanvas(fessId, template || 'default', 'portrait');
}

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
      reported?: 'true' | 'false';
      sort?: 'newest' | 'popular';
      page?: number;
      limit?: number;
    },
    currentUserId?: string,
    viewer?: { id?: string; role?: string; managedBases?: string[] }
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

    // Filter khusus admin base: fess yang punya laporan berstatus pending.
    // Endpoint publik dilindungi oleh BaseController.getBaseFesses.
    if (params.reported === 'true') {
      where.reports = { some: { status: 'pending' } };
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

    const isPublicQuery = !params.query && params.following !== 'true';
    const cacheKey = isPublicQuery
      ? `fesses:${params.base || 'all'}:${params.status || 'published'}:${params.reported || 'false'}:${params.sort || 'newest'}:${page}:${limit}`
      : null;

    const [total, fesses] = cacheKey
      ? await getOrSet(cacheKey, 15000, () =>
          Promise.all([
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
                base: { select: BASE_PREVIEW_SELECT },
              },
            }),
          ])
        )
      : await Promise.all([
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
              base: { select: BASE_PREVIEW_SELECT },
            },
          }),
        ]);

    // Optimize user-specific queries: fetch all votes and bookmarks for these
    // fesses in one round-trip each, instead of per-card queries.
    const fessIds = fesses.map((f) => f.id);
    let userVotes: Array<{ fessId: string; type: string }> = [];
    let userBookmarks: Array<{ fessId: string }> = [];

    if (currentUserId && fessIds.length > 0) {
      [userVotes, userBookmarks] = await Promise.all([
        prisma.vote.findMany({
          where: {
            userId: currentUserId,
            fessId: { in: fessIds },
          },
          select: { fessId: true, type: true },
        }),
        prisma.bookmark.findMany({
          where: {
            userId: currentUserId,
            fessId: { in: fessIds },
          },
          select: { fessId: true },
        }),
      ]);
    }

    const voteMap = new Map((userVotes || []).map((v) => [v.fessId, v.type]));
    const savedSet = new Set((userBookmarks || []).map((b) => b.fessId));

    const data = fesses.map((f) => {
      const canManageInstagram = this.canManageBaseFess(f, viewer);
      return this.serializeFess(f, voteMap.get(f.id) || null, {
        includeIgError: canManageInstagram,
        canManageInstagram,
        isSaved: savedSet.has(f.id),
      });
    });

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
      carousel_order?: string[];
      topic?: string | null;
      scheduled_at?: string | null;
      song?: any;
      template?: string;
      quoted_fess?: any;
      tag?: string | null;
    },
    userId?: string,
    onBackground?: (task: Promise<unknown>) => void
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
      const verdict = ModerationService.classify(payload.content, base.bannedWords || []);
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
        carouselOrder:
          payload.carousel_order && payload.carousel_order.length > 0
            ? payload.carousel_order
            : undefined,
        topic: payload.topic || null,
        scheduledAt: scheduledDate,
        song: payload.song || undefined,
        template: payload.template || 'default',
        quotedFess: payload.quoted_fess || undefined,
        tag: payload.tag || null,
        status: initialStatus,
        autoFlagged,
        flagReason,
        igStatus: initialStatus === 'published' ? 'processing' : 'idle',
        igUpdatedAt: initialStatus === 'published' ? new Date() : null,
      },
    });

    // Counter hanya menghitung fess terbit: mode moderasi menaikkannya di
    // approveFess(); mode auto post menaikkannya tepat di sini karena fess
    // sudah live sejak dibuat.
    if (initialStatus === 'published') {
      await this.adjustFessCounters(fess, 1);
      invalidateCache('bases:');
      invalidateCache('fesses:');

      // Efek publikasi yang sama dengan approveFess (auto-post sosmed).
      // Non-blocking background task agar respon HTTP tidak tertahan render/upload canvas.
      // onBackground dipakai controller untuk waitUntil() di runtime Vercel supaya
      // task tidak dipotong saat response selesai.
      const autoPostTask = exportFessCanvasForAutoPost(fess.id, fess.template).catch(
        (err) => {
          console.error(`[AutoPost] Gagal export canvas fess ${fess.id}:`, err);
        }
      );
      if (onBackground) onBackground(autoPostTask);
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

    return this.serializeFess({ ...fess, base }, null);
  }

  /**
   * Get single fess by ID with full comments
   */
  static async getFessById(
    id: string,
    currentUserId?: string,
    viewer?: { id?: string; role?: string; managedBases?: string[] }
  ) {
    // Status vote/bookmark tidak bergantung pada hasil fess; ambil semuanya
    // sekaligus agar detail tidak menunggu dua round-trip berurutan.
    const [fess, vote, bookmark] = await Promise.all([
      prisma.fess.findUnique({
        where: { id },
        include: {
          comments: {
            orderBy: { createdAt: 'asc' },
            select: COMMENT_PREVIEW_SELECT,
          },
          base: { select: BASE_PREVIEW_SELECT },
        },
      }),
      currentUserId
        ? prisma.vote.findUnique({
            where: {
              fessId_userId: {
                fessId: id,
                userId: currentUserId,
              },
            },
          })
        : Promise.resolve(null),
      currentUserId
        ? prisma.bookmark.findUnique({
            where: {
              fessId_userId: {
                fessId: id,
                userId: currentUserId,
              },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const userVote = vote?.type || null;
    const isSaved = Boolean(bookmark);

    const canManageInstagram = this.canManageBaseFess(fess, viewer);
    return this.serializeFess(fess, userVote, {
      includeIgError: canManageInstagram,
      canManageInstagram,
      isSaved,
    });
  }

  /**
   * Status Instagram ringan untuk polling UI. Sengaja tidak memuat komentar
   * agar aman dipanggil berkala saat badge masih processing/pending.
   */
  static async getInstagramStatus(
    id: string,
    viewer?: { id?: string; role?: string; managedBases?: string[] }
  ) {
    const fess = await prisma.fess.findUnique({
      where: { id },
      select: {
        id: true,
        baseHandle: true,
        postedToIg: true,
        igStatus: true,
        igError: true,
        igAttempts: true,
        igUpdatedAt: true,
        base: { select: { creatorId: true } },
      },
    });

    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const canManageInstagram = this.canManageBaseFess(fess, viewer);

    return {
      id: fess.id,
      posted_to_ig: fess.postedToIg,
      ig_status: fess.igStatus,
      ig_attempts: fess.igAttempts,
      ig_updated_at: fess.igUpdatedAt,
      can_manage_instagram: canManageInstagram,
      ...(canManageInstagram ? { ig_error: fess.igError } : {}),
    };
  }

  /**
   * True bila viewer adalah Super Admin atau admin pengelola base fess.
   * Dipakai untuk detail error IG dan flag aksi di UI.
   */
  private static canManageBaseFess(
    fess: { baseHandle?: string | null; base?: { creatorId?: string | null } | null },
    viewer?: { id?: string; role?: string; managedBases?: string[] }
  ): boolean {
    if (!viewer) return false;
    if (viewer.role === 'Super Admin') return true;
    if (!viewer.role?.includes('Admin')) return false;

    const postHandle = String(fess.baseHandle || '').replace(/^@/, '').toLowerCase();
    const managesBase = (viewer.managedBases || []).some(
      (handle) => String(handle).replace(/^@/, '').toLowerCase() === postHandle
    );
    const ownsBase = Boolean(viewer.id && fess.base?.creatorId === viewer.id);
    return managesBase || ownsBase;
  }

  /** Pastikan user berhak memposting fess ini ke Instagram. */
  static async assertCanManageFess(
    id: string,
    currentUser: { id: string; role: string; managedBases?: string[] }
  ): Promise<void> {
    const fess = await prisma.fess.findUnique({
      where: { id },
      select: {
        baseHandle: true,
        status: true,
        postedToIg: true,
        base: { select: { creatorId: true } },
      },
    });

    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (!this.canManageBaseFess(fess, currentUser)) {
      const err: any = new Error('Anda tidak memiliki izin memposting fess ini ke Instagram');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    if (!PUBLISHED_STATUSES.includes(fess.status)) {
      const err: any = new Error('Hanya fess yang sudah terbit yang dapat diposting ke Instagram');
      err.status = 409;
      err.code = 'FESS_NOT_PUBLISHED';
      throw err;
    }

    if (fess.postedToIg) {
      const err: any = new Error('Fess ini sudah dipublikasikan ke Instagram');
      err.status = 409;
      err.code = 'FESS_ALREADY_POSTED';
      throw err;
    }
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

    invalidateCache('fesses:');
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
  static async approveFess(
    id: string,
    currentUser: { id: string; role: string; managedBases?: string[] },
    onBackground?: (task: Promise<unknown>) => void
  ) {
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

    // Batch database operations dalam satu atomic round-trip transaction:
    // 1) Update status fess
    // 2) Increment counter Base & User (jika fess sebelumnya belum terbit)
    // 3) Create notifikasi untuk author fess
    const dbOperations: any[] = [
      prisma.fess.update({
        where: { id },
        data: {
          status: 'published',
          ...(wasPublished
            ? {}
            : fess.postedToIg
              ? {
                  // Sudah pernah terbit ke IG (mis. setelah reject lalu approve
                  // lagi) — jangan memicu posting/status processing baru.
                  igStatus: 'published',
                  igError: null,
                  igUpdatedAt: new Date(),
                }
              : {
                  igStatus: 'processing',
                  igError: null,
                  igAttempts: 0,
                  igUpdatedAt: new Date(),
                }),
        },
        include: COMMENT_PREVIEW_INCLUDE,
      }),
    ];

    if (!wasPublished) {
      dbOperations.push(...this.getCounterUpdateOperations(fess, 1));
    }

    if (fess.userId) {
      dbOperations.push(
        prisma.notification.create({
          data: {
            userId: fess.userId,
            type: 'moderation',
            fessId: fess.id,
            fessContent: fess.content.slice(0, 60),
            actor: fess.baseHandle,
            text: `Fess kamu di ${fess.baseHandle} telah disetujui & dipublikasikan!`,
          },
        })
      );
    }

    const [updated] = await prisma.$transaction(dbOperations);

    if (!wasPublished) {
      invalidateCache('bases:');
      invalidateCache('fesses:');
    }

    // Auto-post hanya saat transisi pending → published; approve ulang pada
    // fess yang sudah terbit tidak boleh membuat posting Instagram duplikat.
    if (!wasPublished && !fess.postedToIg) {
      const autoPostTask = exportFessCanvasForAutoPost(id, fess.template).catch((err) => {
        console.error(`[AutoPost] Gagal export canvas fess ${id}:`, err);
      });
      if (onBackground) onBackground(autoPostTask);
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

    // Batch database operations dalam satu atomic round-trip transaction:
    // 1) Update status fess ke 'rejected'
    // 2) Decrement counter Base & User (hanya jika sebelumnya statusnya published)
    // 3) Create notifikasi penolakan untuk author fess
    const dbOperations: any[] = [
      prisma.fess.update({
        where: { id },
        data: { status: 'rejected' },
        include: COMMENT_PREVIEW_INCLUDE,
      }),
    ];

    if (wasPublished) {
      dbOperations.push(...this.getCounterUpdateOperations(fess, -1));
    }

    if (fess.userId) {
      dbOperations.push(
        prisma.notification.create({
          data: {
            userId: fess.userId,
            type: 'moderation',
            fessId: fess.id,
            fessContent: fess.content.slice(0, 60),
            actor: fess.baseHandle,
            text: `Fess kamu di ${fess.baseHandle} ditolak moderator`,
          },
        })
      );
    }

    const [updated] = await prisma.$transaction(dbOperations);

    if (wasPublished) {
      invalidateCache('bases:');
      invalidateCache('fesses:');
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
   * Simpan fess ke daftar tersimpan user (idempotent).
   */
  static async bookmarkFess(fessId: string, userId: string) {
    const fess = await prisma.fess.findUnique({
      where: { id: fessId },
      select: { id: true },
    });

    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    await prisma.bookmark.upsert({
      where: { fessId_userId: { fessId, userId } },
      create: { fessId, userId },
      update: {},
    });

    return { saved: true };
  }

  /**
   * Hapus fess dari daftar tersimpan user (idempotent).
   */
  static async unbookmarkFess(fessId: string, userId: string) {
    await prisma.bookmark.deleteMany({ where: { fessId, userId } });
    return { saved: false };
  }

  /**
   * Daftar fess tersimpan milik user. Hanya fess yang masih terbit yang
   * ditampilkan; fess yang di-take down otomatis hilang lewat cascade.
   */
  static async getBookmarkedFesses(
    userId: string,
    params: { page?: number; limit?: number },
    viewer?: { id?: string; role?: string; managedBases?: string[] }
  ) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      userId,
      fess: { status: { in: PUBLISHED_STATUSES } },
    };

    const [total, rows] = await Promise.all([
      prisma.bookmark.count({ where }),
      prisma.bookmark.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { fess: { include: COMMENT_PREVIEW_INCLUDE } },
      }),
    ]);

    const fessIds = rows.map((row) => row.fess.id);
    const userVotes =
      fessIds.length > 0
        ? await prisma.vote.findMany({
            where: { userId, fessId: { in: fessIds } },
            select: { fessId: true, type: true },
          })
        : [];
    const voteMap = new Map((userVotes || []).map((vote) => [vote.fessId, vote.type]));

    const data = rows.map((row) => {
      const canManageInstagram = this.canManageBaseFess(row.fess, viewer);
      return this.serializeFess(row.fess, voteMap.get(row.fess.id) || null, {
        includeIgError: canManageInstagram,
        canManageInstagram,
        isSaved: true,
      });
    });

    return {
      data,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    };
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
      invalidateCache('fesses:');
    }

    // Take down juga harus menghapus postingan Instagram-nya agar tidak
    // tertinggal sebagai konten yatim. Best-effort: kegagalan Meta tidak
    // boleh membatalkan take down di FnC.
    let instagram: { status: 'none' | 'deleted' | 'failed'; detail?: string } = {
      status: 'none',
    };

    if (fess.postedToIg) {
      const igResult = fess.igMediaId
        ? await InstagramService.deletePublishedPost(fess.igMediaId, fess.baseHandle)
        : {
            ok: false,
            detail:
              'ID media Instagram tidak tersimpan (postingan lama). Hapus manual dari aplikasi Instagram.',
          };
      instagram = igResult.ok
        ? { status: 'deleted' }
        : { status: 'failed', detail: igResult.detail };
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

    if (instagram.status === 'failed') {
      await prisma.systemLog
        .create({
          data: {
            source: 'MODERATION',
            message: `Gagal menghapus postingan Instagram fess ${fess.id}: ${instagram.detail || 'unknown error'}`,
            tone: 'error',
          },
        })
        .catch(() => {});
    }

    return { ok: true, instagram };
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

    const fessIds = fesses.map((f) => f.id);
    const savedRows =
      fessIds.length > 0
        ? await prisma.bookmark.findMany({
            where: { userId, fessId: { in: fessIds } },
            select: { fessId: true },
          })
        : [];
    const savedSet = new Set((savedRows || []).map((row) => row.fessId));

    const data = fesses.map((f) =>
      this.serializeFess(f, null, { isSaved: savedSet.has(f.id) })
    );

    return {
      data,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Return array of counter update operations to be executed inside a single batch / transaction.
   */
  private static getCounterUpdateOperations(
    fess: { baseId?: string | null; baseHandle: string; userId?: string | null },
    delta: number
  ) {
    const guard = delta < 0 ? { fessCount: { gt: 0 } } : {};
    const baseWhere = fess.baseId ? { id: fess.baseId } : { handle: fess.baseHandle };

    const ops: any[] = [
      prisma.base.updateMany({
        where: { ...baseWhere, ...guard },
        data: { fessCount: { increment: delta } },
      }),
    ];

    if (fess.userId) {
      ops.push(
        prisma.user.updateMany({
          where: { id: fess.userId, ...guard },
          data: { fessCount: { increment: delta } },
        })
      );
    }

    return ops;
  }

  /**
   * Keep the published-fess counters in sync for a base and its author.
   * delta: +1 when a fess goes live, -1 when it stops being published.
   */
  private static async adjustFessCounters(
    fess: { baseId?: string | null; baseHandle: string; userId?: string | null },
    delta: number
  ) {
    const ops = this.getCounterUpdateOperations(fess, delta);
    if (ops.length === 1) {
      await ops[0];
    } else {
      await prisma.$transaction(ops);
    }
  }

  /**
   * Serialize Fess model into exact OpenAPI Fess schema shape
   */
  static serializeFess(
    fess: any,
    userVote: string | null = null,
    options: { includeIgError?: boolean; canManageInstagram?: boolean; isSaved?: boolean } = {}
  ) {
    return {
      id: fess.id,
      base_handle: fess.baseHandle,
      content: fess.content,
      created_at: new Date(fess.createdAt).getTime(),
      upvotes: fess.upvotes ?? 0,
      downvotes: fess.downvotes ?? 0,
      user_vote: userVote,
      is_saved: Boolean(options.isSaved),
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
      // Status publikasi Instagram dapat dilihat publik; detail error hanya
      // dikirim ke admin (Super Admin / Base Admin) untuk menghindari bocoran
      // teknis Meta.
      ig_status: fess.igStatus || (fess.postedToIg ? 'published' : 'idle'),
      ig_attempts: fess.igAttempts ?? 0,
      ig_updated_at: fess.igUpdatedAt ? new Date(fess.igUpdatedAt).getTime() : null,
      ...(options.includeIgError ? { ig_error: fess.igError || null } : {}),
      ...(options.canManageInstagram !== undefined
        ? { can_manage_instagram: Boolean(options.canManageInstagram) }
        : {}),
      auto_flagged: fess.autoFlagged ?? false,
      flag_reason: fess.flagReason || undefined,
      // Foto profil base untuk avatar kartu fess. `avatar` bisa berupa
      // URL/data-URL foto ATAU inisial teks — frontend membedakan keduanya.
      base_avatar: fess.base?.avatar || undefined,
      base_color: fess.base?.color || undefined,
      base_initial: fess.base?.initial || undefined,
    };
  }
}
