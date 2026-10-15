import { prisma } from '../config/prisma.js';
import { AuthService } from './auth.service.js';

export class UserService {
  /**
   * Get public profile of a user
   */
  static async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        managedBases: { select: { handle: true } },
      },
    });

    if (!user) {
      const err: any = new Error('Pengguna tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    return { user: AuthService.serializeUser(user) };
  }

  /**
   * Update current user's profile
   */
  static async updateProfile(
    userId: string,
    data: { username?: string; bio?: string | null; avatar?: string | null }
  ) {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.username ? { username: data.username.trim() } : {}),
        ...(data.bio !== undefined ? { bio: data.bio } : {}),
        ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
      },
      include: {
        managedBases: { select: { handle: true } },
      },
    });

    return { user: AuthService.serializeUser(updated) };
  }
}
