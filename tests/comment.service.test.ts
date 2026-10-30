import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommentService, anonymousCommentAlias } from '../src/services/comment.service.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    fess: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    comment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    base: { findMany: vi.fn() },
    notification: { create: vi.fn() },
    $transaction: vi.fn((items) => (typeof items === 'function' ? items(prisma) : Promise.all(items))),
  },
}));

const USER = { id: 'usr_1', username: 'rahasia_asli', role: 'User', managedBases: [] };
const OTHER = { id: 'usr_2', username: 'orang_lain', role: 'User', managedBases: [] };
const BASE_ADMIN = {
  id: 'usr_admin',
  username: 'akun_pribadi_admin',
  role: 'Base Admin',
  managedBases: ['@base_a', '@base_b'],
};

const commentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'c_1',
  fessId: 'fess_1',
  userId: USER.id,
  author: 'rahasia_asli',
  text: 'isi komentar',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  user: {
    id: USER.id,
    username: USER.username,
    role: 'User',
    managedBases: [],
  },
  ...overrides,
});

describe('CommentService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw error when fetching comments of non-existent fess', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce(null);

    await expect(CommentService.getComments('fess_none')).rejects.toThrow('tidak ditemukan');
  });

  it('mempertahankan penulis lama untuk komentar tanpa userId', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_1',
      status: 'published',
      baseId: 'base_1',
      baseHandle: '@base_a',
    } as any);
    vi.mocked(prisma.comment.findMany).mockResolvedValueOnce([
      { id: 'c_1', userId: null, author: 'Anon_Ninja', text: 'Komentar keren', createdAt: new Date() },
    ] as any);

    const result = await CommentService.getComments('fess_1');
    expect(result.data[0].author).toBe('Anon_Ninja');
  });

  /**
   * Inti permintaan: komentar harus anonim, tetapi pembaca bisa mengenali
   * balasan dari orang yang sama di dalam satu thread.
   */
  it('menampilkan alias anonim yang stabil per thread dan tidak membocorkan username', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValue({
      id: 'fess_1',
      status: 'published',
      baseId: 'base_1',
      baseHandle: '@base_a',
    } as any);
    vi.mocked(prisma.comment.findMany).mockResolvedValue([
      commentRow({ id: 'c_1' }),
      commentRow({ id: 'c_2' }),
    ] as any);

    const first = await CommentService.getComments('fess_1');
    const alias = anonymousCommentAlias('fess_1', USER.id);

    expect(first.data[0].author).toBe(alias);
    expect(first.data[1].author).toBe(alias);
    expect(first.data[0].author).not.toContain(USER.username);
    expect(alias).toMatch(/^Anonim #[0-9A-F]{4}$/);

    // Thread lain menghasilkan alias berbeda supaya aktivitas tidak bisa
    // dilacak lintas fess.
    expect(anonymousCommentAlias('fess_2', USER.id)).not.toBe(alias);
  });

  it('menampilkan nama base untuk komentar Base Admin, bukan username pribadi', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_1',
      status: 'published',
      baseId: 'base_2',
      baseHandle: '@base_b',
    } as any);
    vi.mocked(prisma.comment.findMany).mockResolvedValueOnce([
      commentRow({
        userId: BASE_ADMIN.id,
        user: {
          id: BASE_ADMIN.id,
          username: BASE_ADMIN.username,
          role: 'Base Admin',
          managedBases: [
            { id: 'base_1', name: 'Base Pertama', handle: '@base_a' },
            { id: 'base_2', name: 'Base Kedua', handle: '@base_b' },
          ],
        },
      }),
    ] as any);

    const result = await CommentService.getComments('fess_1');

    // Base yang memiliki fess dipilih lebih dulu, bukan sekadar base pertama.
    expect(result.data[0].author).toBe('Base Kedua');
    expect(result.data[0].author).not.toContain(BASE_ADMIN.username);
  });

  it('menandai komentar milik sendiri dan hak hapus untuk moderator', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_1',
      status: 'published',
      baseId: 'base_1',
      baseHandle: '@base_a',
    } as any);
    vi.mocked(prisma.comment.findMany).mockResolvedValueOnce([
      commentRow({ id: 'c_mine' }),
      commentRow({
        id: 'c_other',
        userId: OTHER.id,
        user: { id: OTHER.id, username: OTHER.username, role: 'User', managedBases: [] },
      }),
    ] as any);

    const asOwner = await CommentService.getComments('fess_1', 1, 20, USER);
    expect(asOwner.data[0]).toMatchObject({ is_mine: true, can_edit: true, can_delete: true });
    expect(asOwner.data[1]).toMatchObject({ is_mine: false, can_edit: false, can_delete: false });

    const asModerator = await CommentService.getComments('fess_1', 1, 20, {
      ...BASE_ADMIN,
      managedBases: ['@base_a'],
    });
    expect(asModerator.data[0]).toMatchObject({ is_mine: false, can_delete: true });
    expect(asModerator.data[1]).toMatchObject({ is_mine: false, can_delete: true });
  });

  it('should add comment and notify author', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_1',
      userId: 'author_user',
      content: 'Original fess content',
      status: 'published',
      baseId: 'base_1',
      baseHandle: '@base_a',
    } as any);

    vi.mocked(prisma.comment.create).mockResolvedValueOnce({
      id: 'c_new',
      author: anonymousCommentAlias('fess_1', USER.id),
      text: 'Good point',
      createdAt: new Date(),
    } as any);

    const comment = await CommentService.addComment('fess_1', 'Good point', USER);

    expect(comment.id).toBe('c_new');
    expect(comment.text).toBe('Good point');
    // Notifikasi memakai alias, bukan username pemilik akun.
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actor: anonymousCommentAlias('fess_1', USER.id) }),
      })
    );
    expect(JSON.stringify(vi.mocked(prisma.notification.create).mock.calls)).not.toContain(
      USER.username
    );
  });

  it('menyimpan nama base saat Base Admin berkomentar', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_1',
      userId: 'author_user',
      content: 'Original fess content',
      status: 'published',
      baseId: 'base_2',
      baseHandle: '@base_b',
    } as any);
    vi.mocked(prisma.base.findMany).mockResolvedValueOnce([
      { id: 'base_1', name: 'Base Pertama', handle: '@base_a' },
      { id: 'base_2', name: 'Base Kedua', handle: '@base_b' },
    ] as any);
    vi.mocked(prisma.comment.create).mockImplementationOnce((async ({ data }: any) => ({
      id: 'c_admin',
      author: data.author,
      text: data.text,
      createdAt: new Date(),
    })) as any);
    vi.mocked(prisma.fess.update).mockResolvedValueOnce({} as any);

    await CommentService.addComment('fess_1', 'Halo dari base', BASE_ADMIN);

    expect(prisma.base.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { handle: { in: ['@base_a', '@base_b'] } } })
    );
    expect(prisma.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ author: 'Base Kedua' }),
      })
    );
  });

  it('menolak komentar pada fess yang belum terbit', async () => {
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_1',
      userId: 'author_user',
      status: 'pending',
    } as any);

    await expect(CommentService.addComment('fess_1', 'Good point', USER)).rejects.toMatchObject({
      status: 403,
      code: 'FESS_NOT_PUBLISHED',
    });

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

  it('hanya penulis yang boleh mengedit komentarnya', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValueOnce({
      id: 'c_1',
      fessId: 'fess_1',
      userId: USER.id,
      author: 'Anonim',
      text: 'lama',
    } as any);
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_1',
      baseId: 'base_1',
      baseHandle: '@base_a',
    } as any);

    await expect(
      CommentService.updateComment('fess_1', 'c_1', 'diubah', OTHER)
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('mengubah komentar milik sendiri', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValueOnce({
      id: 'c_1',
      fessId: 'fess_1',
      userId: USER.id,
      author: 'Anonim',
      text: 'lama',
    } as any);
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_1',
      baseId: 'base_1',
      baseHandle: '@base_a',
    } as any);
    vi.mocked(prisma.comment.update).mockResolvedValueOnce({
      id: 'c_1',
      author: 'Anonim',
      text: 'baru',
      createdAt: new Date(),
    } as any);

    const updated = await CommentService.updateComment('fess_1', 'c_1', '  baru  ', USER);

    expect(prisma.comment.update).toHaveBeenCalledWith({
      where: { id: 'c_1' },
      data: { text: 'baru' },
    });
    expect(updated.text).toBe('baru');
  });

  it('menghapus komentar sendiri dan mengurangi hitungan dengan guard', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValueOnce({
      id: 'c_1',
      fessId: 'fess_1',
      userId: USER.id,
      author: 'Anonim',
      text: 'isi',
    } as any);
    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_1',
      baseId: 'base_1',
      baseHandle: '@base_a',
    } as any);
    vi.mocked(prisma.comment.delete).mockResolvedValueOnce({ id: 'c_1' } as any);
    vi.mocked(prisma.fess.updateMany).mockResolvedValueOnce({ count: 1 } as any);

    const result = await CommentService.deleteComment('fess_1', 'c_1', USER);

    expect(result).toEqual({ id: 'c_1', deleted: true });
    expect(prisma.fess.updateMany).toHaveBeenCalledWith({
      where: { id: 'fess_1', commentsCount: { gt: 0 } },
      data: { commentsCount: { decrement: 1 } },
    });
  });

  it('Base Admin boleh menghapus komentar di base yang dikelolanya, bukan di base lain', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      id: 'c_1',
      fessId: 'fess_1',
      userId: USER.id,
      author: 'Anonim',
      text: 'isi',
    } as any);
    vi.mocked(prisma.comment.delete).mockResolvedValue({ id: 'c_1' } as any);
    vi.mocked(prisma.fess.updateMany).mockResolvedValue({ count: 1 } as any);

    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_1',
      baseId: 'base_1',
      baseHandle: '@base_a',
    } as any);
    await expect(
      CommentService.deleteComment('fess_1', 'c_1', { ...BASE_ADMIN, managedBases: ['@base_a'] })
    ).resolves.toEqual({ id: 'c_1', deleted: true });

    vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
      id: 'fess_1',
      baseId: 'base_x',
      baseHandle: '@base_x',
    } as any);
    await expect(
      CommentService.deleteComment('fess_1', 'c_1', { ...BASE_ADMIN, managedBases: ['@base_a'] })
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});