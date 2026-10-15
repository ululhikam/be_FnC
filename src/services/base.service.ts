import { prisma } from '../config/prisma.js';
import { formatMembers, getInitials, normalizeHandle } from '../utils/format.util.js';
import { getOrSet, invalidateCache } from '../utils/cache.util.js';

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

    const base = await prisma.base.create({
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
      },
    });

    invalidateCache('bases:');

    return this.serializeBase(base, false);
  }

  /**
   * Get detail base by handle
   */
  static async getBaseByHandle(handle: string, currentUserId?: string) {
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
    if (currentUserId) {
      const follow = await prisma.follow.findUnique({
        where: {
          userId_baseId: {
            userId: currentUserId,
            baseId: base.id,
          },
        },
      });
      isFollowing = !!follow;
    }

    return this.serializeBase(base, isFollowing);
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

    const updated = await prisma.base.update({
      where: { id: base.id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.handle ? { handle: normalizeHandle(data.handle) } : {}),
        ...(data.keywords !== undefined ? { keyword: data.keywords } : {}),
        ...(data.bio !== undefined ? { bio: data.bio } : {}),
        ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
        ...(data.color ? { color: data.color } : {}),
        ...(data.rules ? { rules: data.rules } : {}),
        ...(data.postMode ? { postMode: data.postMode } : {}),
      },
    });

    invalidateCache('bases:');

    return this.serializeBase(updated, false);
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
   * Serialize Base model into exact OpenAPI Base schema shape
   */
  static serializeBase(base: any, isFollowing = false) {
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
      rules: base.rules || [],
      followers_count: base.membersCount ?? 0,
      following_count: 0,
      fess_count: base.fessCount ?? 0,
      is_verified: base.verified ?? false,
      established: base.established || '2024',
      initial: base.initial || 'BA',
      post_mode: base.postMode || 'moderated',
    };
  }
}
