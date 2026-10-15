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

    const notifications = await prisma.notification.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

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

    return { data };
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
}
