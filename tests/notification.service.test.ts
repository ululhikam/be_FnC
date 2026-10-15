import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from '../src/services/notification.service.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    notification: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

describe('NotificationService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should list notifications for user', async () => {
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
});
