import { prisma } from '../config/prisma.js';

export class NotificationService {
  /**
   * Get notifications for a user
   */
  static async getNotifications(
    userId: string,
    params: { type?: string; page?: number; limit?: number }
  ) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (params.type) {
      where.type = params.type;
    }

    const [total, notifications] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const data = notifications.map((n) => ({
      id: n.id,
      type: n.type,
      fess_id: n.fessId || undefined,
      fess_content: n.fessContent || undefined,
      actor: n.actor || 'Anonim',
      text: n.text,
      created_at: new Date(n.createdAt).getTime(),
      read: n.read,
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
   * Mark notifications as read
   */
  static async markAsRead(userId: string, ids: string[]) {
    await prisma.notification.updateMany({
      where: {
        userId,
        id: { in: ids },
      },
      data: { read: true },
    });

    return { ok: true, message: 'Notifikasi berhasil ditandai telah dibaca.' };
  }

  /**
   * Mark every unread notification of a user as read ("baca semua").
   */
  static async markAllAsRead(userId: string) {
    const result = await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });

    return {
      ok: true,
      updated: result.count,
      message: 'Semua notifikasi berhasil ditandai telah dibaca.',
    };
  }

  /**
   * Delete a single notification, scoped to its owner.
   */
  static async deleteNotification(userId: string, id: string) {
    const result = await prisma.notification.deleteMany({
      where: { id, userId },
    });

    if (result.count === 0) {
      const err: any = new Error('Notifikasi tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    return { ok: true, message: 'Notifikasi berhasil dihapus.' };
  }
}
