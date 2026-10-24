import { prisma } from '../config/prisma.js';
import { BASE_TRIAL_DAYS, CTF_PER_PAID_FESS } from '../constants/payments.js';
import {
  HANDLE_CHANGE_COOLDOWN_DAYS,
  getHandleChangeAvailableAt,
} from '../constants/user.js';
import { formatMembers, getInitials, normalizeHandle } from '../utils/format.util.js';
import { getOrSet, invalidateCache } from '../utils/cache.util.js';
import { getBaseBillingState } from './fess-billing.service.js';
import { InstagramService } from './instagram.service.js';

const handleChangeDateFormatter = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'long',
  timeZone: 'Asia/Jakarta',
});

export class BaseService {
  /**
   * List bases with search, category, following filters and pagination
   */
  static async getBases(
    params: {
      search?: string;
      following?: 'true' | 'false';
      category?: string;
      page?: number;
      limit?: number;
    },
    currentUserId?: string
  ) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { handle: { contains: params.search, mode: 'insensitive' } },
        { keyword: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    if (params.category && params.category !== 'Semua') {
      where.category = params.category;
    }

    // Filter following
    if (params.following === 'true' && currentUserId) {
      where.followers = {
        some: { userId: currentUserId },
      };
    }

    // Cache TTL pendek (20 detik): direktori base jarang berubah tapi sering
    // dibaca; semua mutasi base/fess memanggil invalidateCache('bases:').
    return getOrSet(`bases:${currentUserId || 'anon'}:${JSON.stringify(params)}`, 20_000, async () => {
      const [total, bases, userFollows] = await Promise.all([
        prisma.base.count({ where }),
        prisma.base.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ membersCount: 'desc' }, { createdAt: 'desc' }],
        }),
        currentUserId
          ? prisma.follow.findMany({
              where: { userId: currentUserId },
              select: { baseId: true },
            })
          : [],
      ]);

      const followedSet = new Set(userFollows.map((f) => f.baseId));

      const data = bases.map((b) => this.serializeBase(b, followedSet.has(b.id)));

      return {
        data,
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit) || 1,
      };
    });
  }

  /**
   * Create a new base owned by the signed-in admin.
   * Used by the Base Admin onboarding wizard after login/register when the
   * account does not manage a base yet (POST /bases).
   */
  static async createBase(
    userId: string,
    data: {
      name: string;
      handle: string;
      category?: string;
      color?: string;
      keyword?: string | null;
      bio?: string | null;
      avatar?: string | null;
      ig_account?: string | null;
      rules?: string[];
    }
  ) {
    const cleanHandle = normalizeHandle(data.handle);

    const existing = await prisma.base.findUnique({ where: { handle: cleanHandle } });
    if (existing) {
      const err: any = new Error(`Handle ${cleanHandle} sudah digunakan base lain`);
      err.status = 409;
      err.code = 'HANDLE_TAKEN';
      throw err;
    }

    const name = data.name.trim();
    const now = new Date();
    const trialEndsAt = new Date(
      now.getTime() + BASE_TRIAL_DAYS * 24 * 60 * 60 * 1000
    );

    const base = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, baseTrialUsedAt: true },
      });
      if (!user) {
        const err: any = new Error('Pengguna tidak ditemukan');
        err.status = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }

      // Conditional update prevents two parallel base creations from both
      // consuming the creator's one-time trial.
      let trialGranted = false;
      if (!user.baseTrialUsedAt) {
        const claimed = await tx.user.updateMany({
          where: { id: userId, baseTrialUsedAt: null },
          data: { baseTrialUsedAt: now },
        });
        trialGranted = claimed.count === 1;
      }

      const created = await tx.base.create({
        data: {
          name,
          handle: cleanHandle,
          category: data.category || 'Umum',
          color: data.color || '#0055FF',
          keyword: data.keyword || `[${cleanHandle.replace('@', '')}]`,
          bio: data.bio || '',
          avatar: data.avatar || null,
          initial: getInitials(name),
          igAccount: data.ig_account || null,
          rules: data.rules || [],
          creatorId: userId,
          trialStartedAt: trialGranted ? now : null,
          trialEndsAt: trialGranted ? trialEndsAt : null,
          trialSource: trialGranted ? 'new' : null,
        },
      });

      await tx.baseRevenueWallet.create({ data: { baseId: created.id } });
      return created;
    });

    invalidateCache('bases:');

    return this.serializeBase(base, false);
  }

  /**
   * Get detail base by handle
   */
  static async getBaseByHandle(
    handle: string,
    currentUser?: { id?: string; role?: string; managedBases?: string[] }
  ) {
    const cleanHandle = normalizeHandle(handle);

    const base = await prisma.base.findUnique({
      where: { handle: cleanHandle },
    });

    if (!base) {
      const err: any = new Error(`Base ${handle} tidak ditemukan`);
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    let isFollowing = false;
    if (currentUser?.id) {
      const follow = await prisma.follow.findUnique({
        where: {
          userId_baseId: {
            userId: currentUser.id,
            baseId: base.id,
          },
        },
      });
      isFollowing = !!follow;
    }

    // Cooldown metadata is only needed by the people who can edit this base.
    const canManage = Boolean(
      currentUser &&
        (currentUser.role === 'Super Admin' ||
          base.creatorId === currentUser.id ||
          currentUser.managedBases?.some(
            (managed) => normalizeHandle(managed) === cleanHandle
          ))
    );

    // The public profile must not claim auto-post is active based only on the
    // stored @handle: the Meta connection can be disconnected at any time.
    const instagramConnected = await InstagramService.hasActiveInstagramConnection({
      creatorId: base.creatorId,
    });

    return this.serializeBase(base, isFollowing, {
      includeHandleCooldown: canManage,
      instagramConnected,
    });
  }

  /**
   * Toggle follow/unfollow base
   */
  static async toggleFollow(handle: string, userId: string) {
    const cleanHandle = normalizeHandle(handle);

    const base = await prisma.base.findUnique({
      where: { handle: cleanHandle },
    });

    if (!base) {
      const err: any = new Error(`Base ${handle} tidak ditemukan`);
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const existingFollow = await prisma.follow.findUnique({
      where: {
        userId_baseId: {
          userId,
          baseId: base.id,
        },
      },
    });

    if (existingFollow) {
      // Unfollow
      await prisma.$transaction([
        prisma.follow.delete({
          where: { id: existingFollow.id },
        }),
        prisma.base.update({
          where: { id: base.id },
          data: { membersCount: { decrement: 1 } },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { followingCount: { decrement: 1 } },
        }),
      ]);

      invalidateCache('bases:');
      return { is_following: false };
    } else {
      // Follow
      await prisma.$transaction([
        prisma.follow.create({
          data: {
            userId,
            baseId: base.id,
          },
        }),
        prisma.base.update({
          where: { id: base.id },
          data: { membersCount: { increment: 1 } },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { followingCount: { increment: 1 } },
        }),
      ]);

      invalidateCache('bases:');
      return { is_following: true };
    }
  }

  /**
   * Update base settings (admin only)
   */
  static async updateSettings(
    handle: string,
    currentUser: { id: string; role: string; managedBases?: string[] },
    data: {
      name?: string;
      handle?: string;
      keywords?: string | null;
      bio?: string | null;
      avatar?: string | null;
      color?: string;
      rules?: string[];
      postMode?: 'auto' | 'moderated';
      bannedWords?: string[];
    }
  ) {
    const cleanHandle = normalizeHandle(handle);

    const base = await prisma.base.findUnique({
      where: { handle: cleanHandle },
    });

    if (!base) {
      const err: any = new Error(`Base ${handle} tidak ditemukan`);
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    // Permission check
    const isSuperAdmin = currentUser.role === 'Super Admin';
    const isOwner = base.creatorId === currentUser.id;
    const isManager = currentUser.managedBases?.includes(cleanHandle);

    if (!isSuperAdmin && !isOwner && !isManager) {
      const err: any = new Error('Anda tidak memiliki izin mengelola base ini');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    // Base handle mengikuti aturan yang sama dengan handle user: satu kali
    // perubahan per 7 hari. Mengirim handle yang sama tidak mengonsumsi jeda.
    let nextHandle: string | undefined;
    if (data.handle !== undefined) {
      const normalized = normalizeHandle(data.handle);

      if (normalized !== base.handle) {
        const availableAt = getHandleChangeAvailableAt(base.handleChangedAt);
        if (availableAt && Date.now() < availableAt.getTime()) {
          const availableLabel = handleChangeDateFormatter.format(availableAt);
          const err: any = new Error(
            `Handle base hanya dapat diubah sekali setiap ${HANDLE_CHANGE_COOLDOWN_DAYS} hari. ` +
              `Kamu bisa mengganti handle base lagi pada ${availableLabel}.`
          );
          err.status = 429;
          err.code = 'HANDLE_CHANGE_COOLDOWN';
          err.errors = { handle: `Bisa diubah lagi pada ${availableLabel}.` };
          throw err;
        }

        // Handle base juga tidak boleh bertabrakan dengan handle user agar
        // pencarian akun saat login tetap unambiguous.
        const [baseConflict, userConflict] = await Promise.all([
          prisma.base.findFirst({
            where: {
              id: { not: base.id },
              handle: { equals: normalized, mode: 'insensitive' },
            },
            select: { id: true },
          }),
          prisma.user.findFirst({
            where: { handle: { equals: normalized, mode: 'insensitive' } },
            select: { id: true },
          }),
        ]);

        if (baseConflict || userConflict) {
          const err: any = new Error('Handle sudah dipakai. Pilih handle lain.');
          err.status = 409;
          err.code = 'CONFLICT';
          err.errors = { handle: 'Handle sudah dipakai.' };
          throw err;
        }

        nextHandle = normalized;
      }
    }

    // Sanitasi blacklist: trim, buang kosong, dan dedupe case-insensitive
    // supaya filter NLP tidak menyimpan kata dobel.
    const bannedWords =
      data.bannedWords !== undefined
        ? Array.from(
            new Map(
              data.bannedWords
                .map((w) => String(w).trim())
                .filter(Boolean)
                .map((w) => [w.toLowerCase(), w])
            ).values()
          )
        : undefined;

    const updateData: any = {
      ...(data.name ? { name: data.name } : {}),
      ...(nextHandle
        ? { handle: nextHandle, handleChangedAt: new Date() }
        : {}),
      ...(data.keywords !== undefined ? { keyword: data.keywords } : {}),
      ...(data.bio !== undefined ? { bio: data.bio } : {}),
      ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
      ...(data.color ? { color: data.color } : {}),
      ...(data.rules ? { rules: data.rules } : {}),
      ...(data.postMode ? { postMode: data.postMode } : {}),
      ...(bannedWords !== undefined ? { bannedWords } : {}),
    };

    let updated;
    try {
      if (nextHandle) {
        // Fess menyimpan snapshot baseHandle. Pindahkan semuanya dalam satu
        // transaksi supaya link/feed lama tidak tertinggal di handle lama.
        updated = await prisma.$transaction(async (tx) => {
          const saved = await tx.base.update({
            where: { id: base.id },
            data: updateData,
          });
          await tx.fess.updateMany({
            where: {
              OR: [{ baseId: base.id }, { baseHandle: base.handle }],
            },
            data: { baseHandle: nextHandle },
          });
          return saved;
        });
      } else {
        updated = await prisma.base.update({
          where: { id: base.id },
          data: updateData,
        });
      }
    } catch (error: any) {
      // Unique index Base.handle can still lose a race with another request.
      if (error?.code === 'P2002') {
        const err: any = new Error('Handle sudah dipakai. Pilih handle lain.');
        err.status = 409;
        err.code = 'CONFLICT';
        err.errors = { handle: 'Handle sudah dipakai.' };
        throw err;
      }
      throw error;
    }

    invalidateCache('bases:');
    if (nextHandle) invalidateCache('fesses:');

    return this.serializeBase(updated, false, { includeHandleCooldown: true });
  }

  /**
   * Get bases followed by current user — paginated, searchable, and sortable
   * (sort by follow date, base name, or member count).
   */
  static async getFollowingBases(
    userId: string,
    params: { search?: string; sort?: 'newest' | 'name' | 'members'; page?: number; limit?: number } = {}
  ) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { userId };
    const search = params.search?.trim();
    if (search) {
      where.base = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { handle: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const orderBy: any =
      params.sort === 'name'
        ? [{ base: { name: 'asc' } }]
        : params.sort === 'members'
          ? [{ base: { membersCount: 'desc' } }]
          : [{ createdAt: 'desc' }];

    const [total, follows] = await Promise.all([
      prisma.follow.count({ where }),
      prisma.follow.findMany({
        where,
        include: { base: true },
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    const data = follows.map((f) => this.serializeBase(f.base, true));

    return {
      data,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Daftar pengikut (follower) sebuah base — user nyata dari tabel Follow.
   * Paginated + searchable (username/handle), urut dari yang terbaru mengikuti.
   */
  static async getBaseFollowers(
    handle: string,
    params: { search?: string; page?: number; limit?: number } = {}
  ) {
    const cleanHandle = normalizeHandle(handle);

    const base = await prisma.base.findUnique({
      where: { handle: cleanHandle },
      select: { id: true },
    });

    if (!base) {
      const err: any = new Error(`Base ${handle} tidak ditemukan`);
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { baseId: base.id };
    const search = params.search?.trim();
    if (search) {
      where.user = {
        OR: [
          { username: { contains: search, mode: 'insensitive' } },
          { handle: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const [total, follows] = await Promise.all([
      prisma.follow.count({ where }),
      prisma.follow.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              handle: true,
              avatar: true,
              level: true,
              badges: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const data = follows.map((f) => ({
      id: f.user.id,
      username: f.user.username,
      handle: f.user.handle,
      avatar: f.user.avatar || null,
      level: f.user.level ?? 1,
      badges: f.user.badges || [],
      followed_at: f.createdAt ? new Date(f.createdAt).getTime() : null,
    }));

    return {
      data,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Serialize Base model into exact OpenAPI Base schema shape
   */
  static serializeBase(
    base: any,
    isFollowing = false,
    options: { includeHandleCooldown?: boolean; instagramConnected?: boolean } = {}
  ) {
    const handleChangeAvailableAt = getHandleChangeAvailableAt(base.handleChangedAt);
    const billing = getBaseBillingState(base);
    return {
      id: base.id,
      name: base.name,
      handle: base.handle,
      members: formatMembers(base.membersCount ?? 0),
      keyword: base.keyword || `[${base.handle.replace('@', '')}]`,
      avatar: base.avatar || base.initial || 'BA',
      verified: base.verified ?? false,
      color: base.color || '#0055FF',
      category: base.category || 'Umum',
      is_following: isFollowing,
      bio: base.bio || '',
      ig_account: base.igAccount || '',
      billing: {
        requires_payment: billing.requiresPayment,
        reason: billing.reason,
        free_forever: billing.freeForever,
        trial_active: billing.trialActive,
        ctf_cost: billing.requiresPayment ? CTF_PER_PAID_FESS : 0,
      },
      ...(options.instagramConnected !== undefined
        ? { instagram_connected: Boolean(options.instagramConnected) }
        : {}),
      rules: base.rules || [],
      followers_count: base.membersCount ?? 0,
      following_count: 0,
      fess_count: base.fessCount ?? 0,
      is_verified: base.verified ?? false,
      established: base.established || '2024',
      initial: base.initial || 'BA',
      post_mode: base.postMode || 'moderated',
      banned_words: base.bannedWords || [],
      ...(options.includeHandleCooldown
        ? {
            handle_changed_at: base.handleChangedAt
              ? new Date(base.handleChangedAt).getTime()
              : null,
            handle_change_available_at: handleChangeAvailableAt
              ? handleChangeAvailableAt.getTime()
              : null,
            handle_change_cooldown_days: HANDLE_CHANGE_COOLDOWN_DAYS,
            can_change_handle:
              !handleChangeAvailableAt ||
              Date.now() >= handleChangeAvailableAt.getTime(),
          }
        : {}),
    };
  }
}
