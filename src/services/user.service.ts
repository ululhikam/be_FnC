import { prisma } from '../config/prisma.js';
import {
  HANDLE_CHANGE_COOLDOWN_DAYS,
  getHandleChangeAvailableAt,
} from '../constants/user.js';
import { normalizeHandle } from '../utils/format.util.js';
import { AuthService } from './auth.service.js';

const handleChangeDateFormatter = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'long',
  timeZone: 'Asia/Jakarta',
});

export class UserService {
  /**
   * Get public profile of a user
   */
  static async getProfile(userId: string) {
    // `select` eksplisit: tanpa ini Prisma ikut memuat hash password & googleId
    // ke memori, dan serializer publik hanya menyelamatkan sebagian kolom.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        handle: true,
        role: true,
        avatar: true,
        level: true,
        bio: true,
        badges: true,
        igAccount: true,
        followersCount: true,
        followingCount: true,
        fessCount: true,
        createdAt: true,
        managedBases: { select: { handle: true }, orderBy: { createdAt: 'asc' } },
      },
    });

    if (!user) {
      const err: any = new Error('Pengguna tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    return { user: AuthService.serializePublicUser(user) };
  }

  /**
   * Update current user's profile.
   *
   * Handle is the only identity field with a server-enforced cooldown:
   * one change per 7 days. The UI also disables the input, but this check is
   * authoritative so a stale client cannot bypass it.
   */
  static async updateProfile(
    userId: string,
    data: {
      username?: string;
      handle?: string;
      bio?: string | null;
      avatar?: string | null;
    }
  ) {
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, handle: true, handleChangedAt: true },
    });

    if (!current) {
      const err: any = new Error('Pengguna tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    let nextHandle: string | undefined;
    if (data.handle !== undefined) {
      const normalized = normalizeHandle(data.handle);

      // Sending the same handle (e.g. the disabled field is submitted as-is)
      // must not consume the cooldown or create a false "already used" error.
      if (normalized !== current.handle) {
        const availableAt = getHandleChangeAvailableAt(current.handleChangedAt);
        if (availableAt && Date.now() < availableAt.getTime()) {
          const availableLabel = handleChangeDateFormatter.format(availableAt);
          const err: any = new Error(
            `Handle hanya dapat diubah sekali setiap ${HANDLE_CHANGE_COOLDOWN_DAYS} hari. ` +
              `Kamu bisa mengganti handle lagi pada ${availableLabel}.`
          );
          err.status = 429;
          err.code = 'HANDLE_CHANGE_COOLDOWN';
          err.errors = { handle: `Bisa diubah lagi pada ${availableLabel}.` };
          throw err;
        }

        // Prevent collisions with both user handles and base handles, matching
        // the uniqueness rules used when an account is registered.
        const [userConflict, baseConflict] = await Promise.all([
          prisma.user.findFirst({
            where: {
              id: { not: userId },
              handle: { equals: normalized, mode: 'insensitive' },
            },
            select: { id: true },
          }),
          prisma.base.findFirst({
            where: { handle: { equals: normalized, mode: 'insensitive' } },
            select: { id: true },
          }),
        ]);

        if (userConflict || baseConflict) {
          const err: any = new Error('Handle sudah dipakai. Pilih handle lain.');
          err.status = 409;
          err.code = 'CONFLICT';
          err.errors = { handle: 'Handle sudah dipakai.' };
          throw err;
        }

        nextHandle = normalized;
      }
    }

    let updated;
    try {
      updated = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(data.username ? { username: data.username.trim() } : {}),
          ...(nextHandle
            ? { handle: nextHandle, handleChangedAt: new Date() }
            : {}),
          ...(data.bio !== undefined ? { bio: data.bio } : {}),
          ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
        },
        include: {
          managedBases: { select: { handle: true }, orderBy: { createdAt: 'asc' } },
        },
      });
    } catch (error: any) {
      // Handle has a unique index; a concurrent request can still lose the race
      // between the check above and this update.
      if (error?.code === 'P2002') {
        const err: any = new Error('Handle sudah dipakai. Pilih handle lain.');
        err.status = 409;
        err.code = 'CONFLICT';
        err.errors = { handle: 'Handle sudah dipakai.' };
        throw err;
      }
      throw error;
    }

    return { user: AuthService.serializeUser(updated) };
  }
}
