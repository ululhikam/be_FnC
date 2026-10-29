import { prisma } from '../config/prisma.js';
import { normalizeHandle } from '../utils/format.util.js';
import { TOPICS } from '../constants/topics.js';
import { InstagramService } from './instagram.service.js';
import { ModerationService } from './moderation.service.js';
import { FessBillingService, getBaseBillingState } from './fess-billing.service.js';
import { BaseRevenueService } from './base-revenue.service.js';
import { TemplateService } from './template.service.js';
import { TEMPLATES } from '../constants/templates.js';
import { invalidateCache, getOrSet } from '../utils/cache.util.js';

/** Fess counters only track publicly visible confessions. */
const PUBLISHED_STATUSES = ['published', 'approved'];

type FessActor = {
  id: string;
  role?: string;
  email?: string | null;
  emailVerifiedAt?: Date | string | null;
  managedBases?: string[];
};

/** Controller passes the full req.user; older callers/tests pass only an id. */
function normalizeActor(user?: string | FessActor | null): FessActor | null {
  if (!user) return null;
  if (typeof user === 'string') return { id: user };
  return user;
}

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
   * Pastikan key template bisa dirender sebelum fess disimpan.
   *
   * Selama transisi ada dua sumber: tabel `Template` (12 desain SVG baru) dan
   * konstanta `TEMPLATES` (template generatif lama). Key yang tidak ada di
   * keduanya ditolak 422 supaya tidak ada fess dengan template tak bisa render.
   *
   * Base yang sudah punya template khusus tidak boleh memakai katalog umum:
   * key generatif lama dan template bersama ditolak. Pengecualian hanya untuk
   * `default` (klien belum tahu template base) — diganti template khusus
   * pertama milik base agar publikasi tidak gagal.
   */
  static async resolveTemplateKey(raw?: string | null, baseId?: string): Promise<string> {
    const key = String(raw || '').trim() || 'default';
    const hasOwn = baseId ? await TemplateService.hasOwnActive(baseId) : false;

    if (TEMPLATES.some((t) => t.key === key)) {
      // Template generatif lama = katalog umum; tertutup bila base punya template khusus.
      if (!hasOwn) return key;
    } else {
      const record = baseId
        ? await TemplateService.getActiveForBase(key, baseId)
        : await TemplateService.getActive(key);
      if (record) return record.key;
    }

    if (hasOwn && key === 'default' && baseId) {
      const owned = await TemplateService.listActiveForBase(baseId);
      if (owned.length) return owned[0].key;
    }

    const err: any = new Error(`Template ${key} tidak tersedia`);
    err.status = 422;
    err.code = 'VALIDATION_ERROR';
    err.errors = { template: `Template ${key} tidak tersedia untuk base ini` };
    throw err;
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
      idempotency_key?: string | null;
    },
    userOrId?: string | FessActor,
    onBackground?: (task: Promise<unknown>) => void
  ) {
    const actor = normalizeActor(userOrId);
    const cleanHandle = normalizeHandle(payload.base_handle);
    const requestKey = payload.idempotency_key?.trim() || null;

    // A retry with the same client key returns the original fess and never
    // charges CTF twice.
    if (requestKey) {
      const existing = await prisma.fess.findUnique({
        where: { idempotencyKey: requestKey },
        include: { base: { select: BASE_PREVIEW_SELECT } },
      });
      if (existing) {
        if (existing.baseHandle !== cleanHandle) {
          const err: any = new Error('Idempotency-Key sudah dipakai untuk fess lain');
          err.status = 409;
          err.code = 'IDEMPOTENCY_CONFLICT';
          throw err;
        }
        const sameActor = existing.userId ? existing.userId === actor?.id : !actor;
        if (!sameActor) {
          const err: any = new Error('Idempotency-Key sudah dipakai oleh pengguna lain');
          err.status = 409;
          err.code = 'IDEMPOTENCY_CONFLICT';
          throw err;
        }
        return this.serializeFess(existing, null);
      }
    }

    const base = await prisma.base.findUnique({
      where: { handle: cleanHandle },
    });

    if (!base) {
      const err: any = new Error(`Base ${payload.base_handle} tidak ditemukan`);
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const billing = getBaseBillingState(base);

    // Key template divalidasi ke DB sebelum transaksi: fess tersimpan hanya
    // dengan template yang benar-benar bisa dirender.
    const templateKey = await FessService.resolveTemplateKey(payload.template, base.id);

    // Paid bases require a signed-in account with a verified email. During the
    // trial anonymous posting stays available; after the trial it does not.
    if (billing.requiresPayment) {
      if (!actor) {
        const err: any = new Error(
          'Login dengan email terverifikasi diperlukan untuk mengirim fess di base berbayar'
        );
        err.status = 401;
        err.code = 'PAID_FESS_AUTH_REQUIRED';
        throw err;
      }
      if (!actor.emailVerifiedAt) {
        const err: any = new Error(
          'Verifikasi email diperlukan untuk mengirim fess di base berbayar'
        );
        err.status = 403;
        err.code = 'EMAIL_NOT_VERIFIED';
        throw err;
      }
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

    // Base tanpa koneksi Instagram tetap menerbitkan fess secara normal di
    // FnC. Jangan set status processing atau menjadwalkan render canvas.
    const autoPostToInstagram =
      initialStatus === 'published'
        ? await InstagramService.hasActiveInstagramConnection(base)
        : false;

    let transactionResult: { fess: any; charge: any };
    try {
      // Fess paid menyentuh beberapa tabel (fess, wallet, ledger, charge,
      // revenue) dalam satu transaksi. Beri ruang lebih dari default 5 detik:
      // pada jaringan serverless ↔ database yang lambat, transaksi bisa
      // kehabisan waktu sebelum debit CTF selesai dan seluruh posting gagal.
      transactionResult = await prisma.$transaction(
        async (tx) => {
          const created = await tx.fess.create({
            data: {
              baseHandle: cleanHandle,
              baseId: base.id,
              userId: actor?.id || null,
              content: payload.content.trim(),
              media: payload.media && payload.media.length > 0 ? payload.media : undefined,
              carouselOrder:
                payload.carousel_order && payload.carousel_order.length > 0
                  ? payload.carousel_order
                  : undefined,
              topic: payload.topic || null,
              scheduledAt: scheduledDate,
              song: payload.song || undefined,
              template: templateKey,
              quotedFess: payload.quoted_fess || undefined,
              tag: payload.tag || null,
              status: initialStatus,
              autoFlagged,
              flagReason,
              igStatus:
                initialStatus === 'published'
                  ? autoPostToInstagram
                    ? 'processing'
                    : 'skipped'
                  : 'idle',
              igUpdatedAt: initialStatus === 'published' ? new Date() : null,
              publishedAt: initialStatus === 'published' ? new Date() : null,
              idempotencyKey: requestKey || undefined,
            },
          });

          let charged: any = null;
          if (billing.requiresPayment && actor) {
            charged = await FessBillingService.chargeForFess(tx, {
              fessId: created.id,
              userId: actor.id,
              base,
            });
          }

          // Auto-published paid fess earns base revenue immediately. Free-trial
          // and free-forever fesses pass charge=null and never accrue revenue.
          if (initialStatus === 'published') {
            await BaseRevenueService.accrueForPublishedFess(tx, {
              fess: created,
              base,
              charge: charged ? { status: 'CHARGED', amount: charged.amount } : null,
            });
          }

          return { fess: created, charge: charged };
        },
        { maxWait: 10_000, timeout: 30_000 }
      );
    } catch (error) {
      // Two concurrent retries can both miss the idempotency lookup. The
      // unique key makes one transaction fail before any charge is committed;
      // return the winner's row instead of surfacing a 500.
      if (requestKey && (error as any)?.code === 'P2002') {
        const winner = await prisma.fess.findUnique({
          where: { idempotencyKey: requestKey },
          include: { base: { select: BASE_PREVIEW_SELECT } },
        });
        if (
          winner &&
          winner.baseHandle === cleanHandle &&
          (winner.userId ? winner.userId === actor?.id : !actor)
        ) {
          return this.serializeFess(winner, null);
        }
      }
      throw error;
    }

    const { fess, charge } = transactionResult;

    // Counter hanya menghitung fess terbit: mode moderasi menaikkannya di
    // approveFess(); mode auto post menaikkannya tepat di sini karena fess
    // sudah live sejak dibuat.
    if (initialStatus === 'published') {
      await this.adjustFessCounters(fess, 1);
      invalidateCache('bases:');
      invalidateCache('fesses:');

      // Efek publikasi yang sama dengan approveFess (auto-post sosmed) hanya
      // saat base punya koneksi Instagram aktif. Tanpa koneksi, fess cukup
      // terbit di FnC dan tidak ada render/upload canvas.
      // onBackground dipakai controller untuk waitUntil() di runtime Vercel
      // supaya task tidak dipotong saat response selesai.
      if (autoPostToInstagram) {
        const autoPostTask = exportFessCanvasForAutoPost(fess.id, fess.template).catch(
          (err) => {
            console.error(`[AutoPost] Gagal export canvas fess ${fess.id}:`, err);
          }
        );
        if (onBackground) onBackground(autoPostTask);
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
    if (actor && base.creatorId !== actor.id) {
      try {
        const existingFollow = await prisma.follow.findUnique({
          where: { userId_baseId: { userId: actor.id, baseId: base.id } },
          select: { id: true },
        });

        if (!existingFollow) {
          await prisma.$transaction([
            prisma.follow.create({ data: { userId: actor.id, baseId: base.id } }),
            prisma.base.update({
              where: { id: base.id },
              data: { membersCount: { increment: 1 } },
            }),
            prisma.user.update({
              where: { id: actor.id },
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

    return {
      ...this.serializeFess({ ...fess, base }, null),
      charged_ctf: charge?.amount ?? 0,
      ctf_balance: charge?.balanceAfter ?? undefined,
      base_billing: {
        requires_payment: billing.requiresPayment,
        reason: billing.reason,
        free_forever: billing.freeForever,
        trial_active: billing.trialActive,
      },
    };
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
   * True bila viewer adalah admin pengelola base fess.
   * Base moderation is Base-Admin-only; Super Admin has no equivalent shortcut.
   */
  private static canManageBaseFess(
    fess: { baseHandle?: string | null; base?: { creatorId?: string | null } | null },
    viewer?: { id?: string; role?: string; managedBases?: string[] }
  ): boolean {
    if (!viewer || viewer.role !== 'Base Admin') return false;

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
  ): Promise<{ baseHandle: string; creatorId: string | null }> {
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

    return {
      baseHandle: fess.baseHandle,
      creatorId: fess.base?.creatorId || null,
    };
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
      include: {
        base: true,
        charge: { select: { id: true, status: true, amount: true } },
      },
    });

    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const isBaseAdmin =
      currentUser.role === 'Base Admin' &&
      (currentUser.managedBases?.includes(fess.baseHandle) ||
        fess.base?.creatorId === currentUser.id);

    if (!isBaseAdmin) {
      const err: any = new Error('Anda tidak memiliki izin memoderasi fess ini');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    if (fess.charge?.status === 'REFUNDED') {
      const err: any = new Error(
        'CTF untuk fess ini sudah direfund. Fess tidak dapat diterbitkan kembali; minta pengirim membuat fess baru.'
      );
      err.status = 409;
      err.code = 'FESS_CHARGE_REFUNDED';
      throw err;
    }

    const wasPublished = PUBLISHED_STATUSES.includes(fess.status);

    // Hanya cek koneksi saat fess benar-benar akan terbit pertama kali dan
    // belum pernah diposting ke IG. Base FnC-only melewati seluruh proses sosmed.
    const autoPostToInstagram =
      !wasPublished && !fess.postedToIg
        ? await InstagramService.hasActiveInstagramConnection(fess.base || fess.baseHandle)
        : false;

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.fess.update({
        where: { id },
        data: {
          status: 'published',
          // Preserve the first publication timestamp when a fess is approved
          // again after a take-down. Refund policy must remain based on the
          // first publication, not the current status.
          publishedAt: fess.publishedAt ?? new Date(),
          ...(wasPublished
            ? {}
            : fess.postedToIg
              ? {
                  // Sudah pernah terbit ke IG (mis. setelah reject lalu approve
                  // lagi) - jangan memicu posting/status processing baru.
                  igStatus: 'published',
                  igError: null,
                  igUpdatedAt: new Date(),
                }
              : autoPostToInstagram
                ? {
                    igStatus: 'processing',
                    igError: null,
                    igAttempts: 0,
                    igUpdatedAt: new Date(),
                  }
                : {
                    // Base belum menghubungkan sosmed — terbit normal di FnC.
                    igStatus: 'skipped',
                    igError: null,
                    igAttempts: 0,
                    igUpdatedAt: new Date(),
                  }),
        },
        include: COMMENT_PREVIEW_INCLUDE,
      });

      if (!wasPublished) {
        await tx.base.updateMany({
          where: fess.baseId ? { id: fess.baseId } : { handle: fess.baseHandle },
          data: { fessCount: { increment: 1 } },
        });
        if (fess.userId) {
          await tx.user.updateMany({
            where: { id: fess.userId },
            data: { fessCount: { increment: 1 } },
          });
        }
      }

      if (fess.userId) {
        await tx.notification.create({
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

      // Revenue hanya untuk fess berbayar (punya FessCharge CHARGED). Fess
      // trial/freeForever tidak pernah menghasilkan revenue base.
      if (!wasPublished && fess.base && fess.charge?.status === 'CHARGED') {
        await BaseRevenueService.accrueForPublishedFess(tx, {
          fess,
          base: fess.base,
          charge: { status: 'CHARGED', amount: fess.charge.amount },
        });
      }

      return row;
    });

    if (!wasPublished) {
      invalidateCache('bases:');
      invalidateCache('fesses:');
    }

    // Auto-post hanya saat transisi pending -> published pada base yang punya
    // koneksi Instagram aktif. Approve ulang tidak boleh membuat posting ganda.
    if (autoPostToInstagram) {
      const autoPostTask = exportFessCanvasForAutoPost(id, fess.template).catch((err) => {
        console.error(`[AutoPost] Gagal export canvas fess ${id}:`, err);
      });
      if (onBackground) onBackground(autoPostTask);
    }

    return this.serializeFess(updated, null);
  }

  static async rejectFess(
    id: string,
    currentUser: { id: string; role: string; managedBases?: string[] }
  ) {
    const fess = await prisma.fess.findUnique({
      where: { id },
      include: {
        base: true,
        charge: { select: { id: true, status: true, amount: true } },
      },
    });

    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const isBaseAdmin =
      currentUser.role === 'Base Admin' &&
      (currentUser.managedBases?.includes(fess.baseHandle) ||
        fess.base?.creatorId === currentUser.id);

    if (!isBaseAdmin) {
      const err: any = new Error('Anda tidak memiliki izin memoderasi fess ini');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const wasPublished = PUBLISHED_STATUSES.includes(fess.status);
    const wasEverPublished = wasPublished || Boolean(fess.publishedAt);

    const { updated, refund, reversal } = await prisma.$transaction(async (tx) => {
      const row = await tx.fess.update({
        where: { id },
        data: { status: 'rejected' },
        include: COMMENT_PREVIEW_INCLUDE,
      });

      if (wasPublished) {
        await tx.base.updateMany({
          where: {
            ...(fess.baseId ? { id: fess.baseId } : { handle: fess.baseHandle }),
            fessCount: { gt: 0 },
          },
          data: { fessCount: { increment: -1 } },
        });
        if (fess.userId) {
          await tx.user.updateMany({
            where: { id: fess.userId, fessCount: { gt: 0 } },
            data: { fessCount: { increment: -1 } },
          });
        }
      }

      if (fess.userId) {
        await tx.notification.create({
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

      // Refund hanya jika fess belum pernah terbit. Status saat ini tidak
      // cukup: fess yang pernah terbit lalu ditolak tetap tidak boleh refund.
      const refundResult = !wasEverPublished
        ? await FessBillingService.refundForUnpublishedFess(tx, {
            fessId: fess.id,
            reason: 'Fess ditolak sebelum terbit',
          })
        : { refunded: false as const, amount: 0 };

      // Fess berbayar yang pernah terbit kehilangan revenue base-nya. Operasi
      // ini idempotent, jadi aman jika fess ditolak ulang.
      const reversalResult = wasEverPublished
        ? await BaseRevenueService.reverseForFess(tx, {
            fessId: fess.id,
            reason: 'Fess diturunkan setelah terbit',
            reversedById: currentUser.id,
          })
        : null;

      return { updated: row, refund: refundResult, reversal: reversalResult };
    });

    if (wasPublished) {
      invalidateCache('bases:');
      invalidateCache('fesses:');
    }

    const result: any = this.serializeFess(updated, null);
    if (refund.refunded) {
      result.refunded_ctf = refund.amount;
      result.ctf_balance = (refund as any).balanceAfter;
    }
    if (reversal) {
      result.revenue_reversal = {
        amount_idr: reversal.amountIdr,
        status: reversal.status,
      };
    }
    return result;
  }

  static async reportFess(fessId: string, reason: string, userId: string, note?: string | null) {
    const fess = await prisma.fess.findUnique({ where: { id: fessId } });
    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    // Cegah duplikasi: satu user hanya boleh melaporkan satu fess sekali
    const existing = await prisma.report.findFirst({ where: { fessId, userId } });
    if (existing) {
      const err: any = new Error('Anda sudah melaporkan fess ini sebelumnya');
      err.status = 409;
      err.code = 'DUPLICATE_REPORT';
      throw err;
    }

    await prisma.report.create({
      data: {
        fessId,
        reason,
        note: note || null,
        userId,
      },
    });

    await prisma.systemLog.create({
      data: {
        source: 'MODERATION',
        message: `Laporan fess ${fessId} dari ${fess.baseHandle} oleh user ${userId} (${reason})`,
        tone: 'info',
      },
    });

    return { ok: true, message: 'Laporan berhasil dikirim dan akan ditinjau oleh tim moderasi.' };
  }

  /**
   * Daftar laporan pada satu fess + jumlah pelapor unik.
   * Hanya Base Admin yang mengelola base fess tersebut (atau Super Admin read-only).
   */
  static async getFessReports(
    fessId: string,
    currentUser: { id: string; role: string; managedBases?: string[] }
  ) {
    const fess = await prisma.fess.findUnique({
      where: { id: fessId },
      select: {
        id: true,
        baseHandle: true,
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
      const err: any = new Error('Anda tidak memiliki izin melihat laporan fess ini');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const reports = await prisma.report.findMany({
      where: { fessId },
      include: {
        user: { select: { id: true, username: true, handle: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const uniqueReporters = new Set(reports.map((r) => r.userId).filter(Boolean));

    return {
      fessId,
      totalReports: reports.length,
      uniqueReporters: uniqueReporters.size,
      reports: reports.map((r) => ({
        id: r.id,
        reason: r.reason,
        note: r.note,
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        user: r.user
          ? { id: r.user.id, username: r.user.username, handle: r.user.handle }
          : null,
      })),
    };
  }

  static async dismissFessReport(
    fessId: string,
    currentUser: { id: string; role: string; managedBases?: string[] },
    reason?: string | null
  ) {
    return this.updateReportStatus(fessId, 'dismissed', currentUser, reason);
  }

  static async resolveFessReport(
    fessId: string,
    currentUser: { id: string; role: string; managedBases?: string[] },
    reason?: string | null
  ) {
    return this.updateReportStatus(fessId, 'resolved', currentUser, reason);
  }

  private static async updateReportStatus(
    fessId: string,
    targetStatus: 'dismissed' | 'resolved',
    currentUser: { id: string; role: string; managedBases?: string[] },
    reason?: string | null
  ) {
    const fess = await prisma.fess.findUnique({
      where: { id: fessId },
      select: {
        id: true,
        baseHandle: true,
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
      const err: any = new Error('Anda tidak memiliki izin mengelola laporan fess ini');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const updated = await prisma.report.updateMany({
      where: { fessId, status: 'pending' },
      data: { status: targetStatus },
    });

    await prisma.systemLog.create({
      data: {
        source: 'MODERATION',
        message: `${targetStatus.toUpperCase()} laporan fess ${fessId} dari ${fess.baseHandle} oleh ${currentUser.role} (${currentUser.id})${reason ? ` — alasan: ${reason}` : ''}`,
        tone: 'info',
      },
    });

    return {
      ok: true,
      message: `Laporan berhasil ditandai sebagai ${targetStatus}.`,
      updatedCount: updated.count,
    };
  }

  /**
   * Tandai fess sebagai post manual ke Instagram. Admin base menyimpan URL
   * postingan Instagram hasil post manual untuk tracking. Tidak memicu Meta API,
   * dan igMediaId tetap kosong (shortcode bukan Graph API media ID).
   */
  static async manualIgPost(
    fessId: string,
    igPostUrl: string,
    currentUser: { id: string; role: string; managedBases?: string[] },
    note?: string | null
  ) {
    // assertCanManageFess sudah memvalidasi: fess ada, base admin, published, belum postedToIg
    const target = await this.assertCanManageFess(fessId, currentUser);

    const updated = await prisma.fess.update({
      where: { id: fessId },
      data: {
        postedToIg: true,
        igStatus: 'published',
        igUpdatedAt: new Date(),
        igPostUrl,
        igPostMethod: 'manual',
        igPostedAt: new Date(),
        // igMediaId sengaja tetap null untuk post manual (shortcode bukan media ID Graph API)
      },
    });

    await prisma.systemLog.create({
      data: {
        source: 'MODERATION',
        message: `Manual IG post fess ${fessId} dari ${target.baseHandle} oleh ${currentUser.role} (${currentUser.id}) — URL: ${igPostUrl}${note ? ` — catatan: ${note}` : ''}`,
        tone: 'info',
      },
    });

    return {
      ok: true,
      message: 'Fess ditandai sebagai post manual ke Instagram.',
      ig_post_url: updated.igPostUrl,
      ig_post_method: updated.igPostMethod,
      ig_posted_at: updated.igPostedAt,
    };
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
  static async deleteFess(
    id: string,
    currentUser: { id: string; role: string; managedBases?: string[] }
  ) {
    const fess = await prisma.fess.findUnique({
      where: { id },
      include: {
        base: { select: { creatorId: true } },
        charge: { select: { id: true, status: true, amount: true } },
      },
    });
    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const isAuthor = fess.userId === currentUser.id;
    const isBaseAdmin =
      currentUser.role === 'Base Admin' &&
      (fess.base?.creatorId === currentUser.id ||
        currentUser.managedBases?.includes(fess.baseHandle));

    if (!isAuthor && !isBaseAdmin) {
      const err: any = new Error('Anda tidak memiliki izin menghapus fess ini');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const wasPublished = PUBLISHED_STATUSES.includes(fess.status);
    const wasEverPublished = wasPublished || Boolean(fess.publishedAt);
    const chargeStatus = fess.charge?.status;

    // Refund/reversal must happen before the fess row is deleted because the
    // foreign keys use SET NULL. A charged fess that never published gets its
    // CTF back; a fess that was ever published reverses base revenue but can
    // never refund CTF, even if it is currently rejected.
    const { refund, reversal } = await prisma.$transaction(async (tx) => {
      const refundResult =
        !wasEverPublished && chargeStatus === 'CHARGED'
          ? await FessBillingService.refundForUnpublishedFess(tx, {
              fessId: fess.id,
              reason: 'Fess dihapus sebelum terbit',
            })
          : { refunded: false as const, amount: 0 };

      const reversalResult =
        wasEverPublished && chargeStatus === 'CHARGED'
          ? await BaseRevenueService.reverseForFess(tx, {
              fessId: fess.id,
              reason: 'Fess dihapus setelah terbit',
              reversedById: currentUser.id,
            })
          : null;

      await tx.fess.delete({ where: { id } });

      if (wasPublished) {
        await tx.base.updateMany({
          where: {
            ...(fess.baseId ? { id: fess.baseId } : { handle: fess.baseHandle }),
            fessCount: { gt: 0 },
          },
          data: { fessCount: { increment: -1 } },
        });
        if (fess.userId) {
          await tx.user.updateMany({
            where: { id: fess.userId, fessCount: { gt: 0 } },
            data: { fessCount: { increment: -1 } },
          });
        }
      }

      return { refund: refundResult, reversal: reversalResult };
    });

    // Removing a published fess must not leave a stale published count.
    if (wasPublished) {
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

    return {
      ok: true,
      instagram,
      ...(refund.refunded
        ? { refunded_ctf: refund.amount, ctf_balance: (refund as any).balanceAfter }
        : {}),
      ...(reversal
        ? {
            revenue_reversal: {
              amount_idr: reversal.amountIdr,
              status: reversal.status,
            },
          }
        : {}),
    };
  }

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
      // Cover Instagram (slide 0). Judul bersifat final — UI hanya menampilkan.
      thumbnail_url: fess.thumbnailUrl || undefined,
      thumbnail_title: fess.thumbnailTitle || undefined,
      thumbnail_status: fess.thumbnailStatus || 'idle',
      ...(options.includeIgError ? { thumbnail_error: fess.thumbnailError || null } : {}),
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
