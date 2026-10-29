import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommentService } from '../src/services/comment.service.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    fess: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    comment: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    $transaction: vi.fn((items) => (typeof items === 'function' ? items(prisma) : Promise.all(items))),
  },
}));

describe('CommentService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw error when fetching comments of non-existent fess', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce(null);

    await expect(CommentService.getComments('fess_none')).rejects.toThrow('tidak ditemukan');
  });

  it('should return comments for fess', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({ id: 'fess_1' } as any);
    vi.mocked(prisma.comment.findMany).mockResolvedValueOnce([
      {
        id: 'c_1',
        author: 'Anon_Ninja',
        text: 'Komentar keren',
        createdAt: new Date(),
      } as any,
    ]);

    const result = await CommentService.getComments('fess_1');
    expect(result.data.length).toBe(1);
    expect(result.data[0].author).toBe('Anon_Ninja');
  });

  it('should add comment and notify author', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_1',
      userId: 'author_user',
      content: 'Original fess content',
    } as any);

    vi.mocked(prisma.comment.create).mockResolvedValueOnce({
      id: 'c_new',
      author: 'Tester',
      text: 'Good point',
      createdAt: new Date(),
    } as any);

    const comment = await CommentService.addComment('fess_1', 'Good point', {
      id: 'commenter_user',
      username: 'Tester',
    });

    expect(comment.id).toBe('c_new');
    expect(comment.text).toBe('Good point');
    expect(prisma.notification.create).toHaveBeenCalled();
  });

  it('menolak komentar pada fess yang belum terbit', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_1',
      userId: 'author_user',
      status: 'pending',
    } as any);

    await expect(
      CommentService.addComment('fess_1', 'Good point', {
        id: 'commenter_user',
        username: 'Tester',
      })
    ).rejects.toMatchObject({ status: 403, code: 'FESS_NOT_PUBLISHED' });

    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('menyembunyikan komentar fess yang belum terbit sebagai 404', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_1',
      status: 'rejected',
    } as any);
    vi.mocked(prisma.comment.findMany).mockResolvedValueOnce([
      { id: 'c1', author: 'Anon', text: 'isi', createdAt: new Date() },
    ] as any);

    await expect(CommentService.getComments('fess_1')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});
