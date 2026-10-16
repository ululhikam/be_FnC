import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from '../src/services/notification.service.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    notification: {
      count: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe('NotificationService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should list notifications for user', async () => {
    vi.mocked(prisma.notification.count)
      .mockResolvedValueOnce(1) // total
      .mockResolvedValueOnce(1); // unread_count
    vi.mocked(prisma.notification.findMany).mockResolvedValueOnce([
      {
        id: 'n_1',
        type: 'comment',
        text: 'Seseorang membalas fess kamu',
        read: false,
        createdAt: new Date(),
      } as any,
    ]);

    const result = await NotificationService.getNotifications('usr_1', {});
    expect(result.data.length).toBe(1);
    expect(result.data[0].id).toBe('n_1');
    expect(result.data[0].read).toBe(false);
    expect(result.total).toBe(1);
    expect(result.unread_count).toBe(1);
    expect(result.total_pages).toBe(1);
  });

  it('should get unread notifications count', async () => {
    vi.mocked(prisma.notification.count).mockResolvedValueOnce(5);

    const result = await NotificationService.getUnreadCount('usr_1');
    expect(result.unread_count).toBe(5);
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: 'usr_1', read: false },
    });
  });

  it('should mark notifications as read', async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValueOnce({ count: 2 } as any);

    const result = await NotificationService.markAsRead('usr_1', ['n_1', 'n_2']);
    expect(result.ok).toBe(true);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'usr_1',
        id: { in: ['n_1', 'n_2'] },
      },
      data: { read: true },
    });
  });

  it('should mark all unread notifications as read', async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValueOnce({ count: 3 } as any);

    const result = await NotificationService.markAllAsRead('usr_1');

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'usr_1', read: false },
      data: { read: true },
    });
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(3);
  });

  it('should delete an owned notification', async () => {
    vi.mocked(prisma.notification.deleteMany).mockResolvedValueOnce({ count: 1 } as any);

    const result = await NotificationService.deleteNotification('usr_1', 'n_1');

    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: 'n_1', userId: 'usr_1' },
    });
    expect(result.ok).toBe(true);
  });

  it('should throw 404 when deleting a missing notification', async () => {
    vi.mocked(prisma.notification.deleteMany).mockResolvedValueOnce({ count: 0 } as any);

    await expect(NotificationService.deleteNotification('usr_1', 'n_missing')).rejects.toThrow(
      'tidak ditemukan'
    );
  });
});
