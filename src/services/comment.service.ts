import crypto from 'crypto';
import { prisma } from '../config/prisma.js';
import { ENV } from '../config/env.js';

/** Secret terpisah dari JWT agar alias tidak bisa dipakai untuk menebak token. */
const COMMENT_ALIAS_SECRET = `${ENV.JWT_SECRET}:comment-alias`;

export interface CommentViewer {
  id: string;
  username: string;
  role: string;
  /** Diisi `requireAuth` sebagai daftar handle base yang dikelola. */
  managedBases?: string[];
}

interface IdentityBase {
  id?: string;
  name: string;
  handle: string;
  avatar?: string | null;
  color?: string | null;
  initial?: string | null;
}

interface CommentIdentityUser {
  id: string;
  username: string;
  role: string;
  managedBases?: IdentityBase[];
}

interface ResolvedCommentAuthor {
  name: string;
  /** URL/data-URL foto base atau inisial teks; null untuk komentator anonim. */
  avatar: string | null;
  /** Warna brand base, dipakai sebagai latar avatar. */
  color: string | null;
}

interface CommentFess {
  id: string;
  baseId?: string | null;
  baseHandle?: string | null;
}

const normalizeHandle = (value?: string | null) =>
  String(value || '')
    .replace(/^@/, '')
    .toLowerCase();

function fail(message: string, status: number, code: string): never {
  const err: any = new Error(message);
  err.status = status;
  err.code = code;
  throw err;
}

/**
 * Alias anonim yang stabil per (fess, user).
 *
 * Satu pengguna mendapat alias yang sama di sepanjang thread sehingga pembaca
 * bisa mengikuti percakapan ("orang yang sama membalas"), tetapi alias berbeda
 * di thread lain agar aktivitas lintas-fess tidak bisa dilacak. Turunan HMAC
 * memastikan alias tidak bisa dihitung dari userId/handle publik.
 */
export function anonymousCommentAlias(fessId: string, userId: string): string {
  const digest = crypto
    .createHmac('sha256', COMMENT_ALIAS_SECRET)
    .update(`${fessId}:${userId}`)
    .digest('hex')
    .slice(0, 4)
    .toUpperCase();
  return `Anonim #${digest}`;
}

/**
 * Identitas yang tampil di komentar.
 *
 * - Base Admin tampil sebagai nama base yang dikelolanya (bukan akun pribadi),
 *   lengkap dengan avatar/warna base agar mudah dikenali.
 * - Super Admin tampil sebagai "Tim FnC".
 * - Pengguna biasa tampil sebagai alias anonim per thread tanpa avatar pribadi.
 */
function resolveCommentAuthor(
  user: CommentIdentityUser,
  fess: CommentFess
): ResolvedCommentAuthor {
  if (user.role === 'Base Admin') {
    const bases = user.managedBases || [];
    const own =
      bases.find((base) => base.id && base.id === fess.baseId) ||
      bases.find((base) => normalizeHandle(base.handle) === normalizeHandle(fess.baseHandle)) ||
      bases[0];
    const name = own?.name || 'Base Admin';
    const configuredAvatar = typeof own?.avatar === 'string' ? own.avatar.trim() : '';
    const initial = typeof own?.initial === 'string' ? own.initial.trim() : '';

    return {
      name,
      // Base boleh belum punya foto. Pakai inisial base, lalu inisial nama
      // base, supaya komentar base tidak jatuh ke ikon pengguna generik.
      avatar: configuredAvatar || initial || name.slice(0, 2).toUpperCase() || null,
      color: own?.color || null,
    };
  }

  if (user.role === 'Super Admin') {
    return { name: 'Tim FnC', avatar: null, color: null };
  }

  return {
    name: anonymousCommentAlias(fess.id, user.id),
    avatar: null,
    color: null,
  };
}

/** Base Admin hanya boleh memoderasi komentar di base yang ia kelola. */
function canModerate(viewer: CommentViewer | undefined, fess: CommentFess): boolean {
  if (!viewer) return false;
  if (viewer.role === 'Super Admin') return true;
  if (viewer.role !== 'Base Admin') return false;
  return (viewer.managedBases || []).some(
    (handle) => normalizeHandle(handle) === normalizeHandle(fess.baseHandle)
  );
}

export class CommentService {
  /**
   * Fess hanya boleh dikomentari/di-vote setelah terbit. Baris lama tanpa
   * `status` (mis. data hasil migrasi) dianggap terbit agar tidak mengunci
   * konten yang sudah tampil di feed.
   */
  static isPubliclyVisible(fess: { status?: string | null }): boolean {
    if (!fess.status) return true;
    return fess.status === 'published' || fess.status === 'approved';
  }

  /**
   * Get comments for a fess
   */
  static async getComments(fessId: string, page = 1, limit = 20, viewer?: CommentViewer) {
    const skip = (page - 1) * limit;

    // Dua query ini tidak saling bergantung. Jalankan paralel agar daftar
    // komentar tidak menunggu query validasi fess lebih dulu.
    const [fess, comments] = await Promise.all([
      prisma.fess.findUnique({
        where: { id: fessId },
        select: { id: true, status: true, baseId: true, baseHandle: true },
      }),
      prisma.comment.findMany({
        where: { fessId },
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              role: true,
              managedBases: {
                select: {
                  id: true,
                  name: true,
                  handle: true,
                  avatar: true,
                  color: true,
                  initial: true,
                },
                orderBy: { createdAt: 'asc' },
              },
            },
          },
        },
      }),
    ]);

    if (!fess) fail('Fess tidak ditemukan', 404, 'NOT_FOUND');

    // Komentar fess non-terbit tidak boleh dibaca publik: isinya bisa memuat
    // potongan konten yang belum lolos moderasi.
    if (!CommentService.isPubliclyVisible(fess)) fail('Fess tidak ditemukan', 404, 'NOT_FOUND');

    const viewerCanModerate = canModerate(viewer, fess);

    const data = comments.map((c) => {
      // Baris legacy bisa menyimpan username asli. Selama `userId` ada, nama
      // tampilan dihitung ulang agar handle tidak pernah bocor di feed.
      const identity = c.user
        ? resolveCommentAuthor(c.user as CommentIdentityUser, fess)
        : { name: c.author || 'Anonim', avatar: null, color: null };
      const isMine = Boolean(viewer && c.userId === viewer.id);

      return {
        id: c.id,
        parent_id: c.parentId ?? null,
        author: identity.name,
        author_avatar: identity.avatar,
        author_color: identity.color,
        text: c.text,
        created_at: new Date(c.createdAt).getTime(),
        is_mine: isMine,
        can_edit: isMine,
        can_delete: isMine || viewerCanModerate,
      };
    });

    return { data };
  }

  /**
   * Add comment to a fess
   */
  static async addComment(
    fessId: string,
    text: string,
    currentUser?: CommentViewer,
    parentId?: string | null
  ) {
    const fess = await prisma.fess.findUnique({ where: { id: fessId } });
    if (!fess) fail('Fess tidak ditemukan', 404, 'NOT_FOUND');

    // Komentar pada fess yang belum/tidak terbit hanya akan muncul ke publik
    // setelah fess itu terbit, dan saat ini membuka jalan bagi penyerang untuk
    // menguji/membanjiri antrean moderasi. Tolak sampai fess benar-benar terbit.
    if (!CommentService.isPubliclyVisible(fess)) {
      fail('Fess ini belum terbit sehingga belum bisa dikomentari.', 403, 'FESS_NOT_PUBLISHED');
    }

    const resolvedParentId = await CommentService.resolveReplyParent(fessId, parentId);

    const identity = await CommentService.resolveNewCommentAuthor(currentUser, fess);

    const [comment] = await prisma.$transaction([
      prisma.comment.create({
        data: {
          fessId,
          userId: currentUser?.id || null,
          parentId: resolvedParentId,
          author: identity.name,
          text: text.trim(),
        },
      }),
      prisma.fess.update({
        where: { id: fessId },
        data: { commentsCount: { increment: 1 } },
      }),
    ]);

    // Send notification to fess author if author is registered and not the commenter
    if (fess.userId && fess.userId !== currentUser?.id) {
      await prisma.notification.create({
        data: {
          userId: fess.userId,
          type: 'comment',
          fessId: fess.id,
          fessContent: fess.content.slice(0, 60),
          actor: identity.name,
          text: `membalas fessmu: "${text.slice(0, 40)}${text.length > 40 ? '...' : ''}"`,
        },
      });
    }

    return {
      id: comment.id,
      parent_id: comment.parentId ?? null,
      author: comment.author,
      author_avatar: identity.avatar,
      author_color: identity.color,
      text: comment.text,
      created_at: new Date(comment.createdAt).getTime(),
      is_mine: Boolean(currentUser),
      can_edit: Boolean(currentUser),
      can_delete: Boolean(currentUser),
    };
  }

  /**
   * Balasan hanya boleh menempel ke komentar di fess yang sama. Balasan dari
   * balasan diratakan ke induk teratas supaya tampilan tetap dua tingkat.
   */
  private static async resolveReplyParent(
    fessId: string,
    parentId?: string | null
  ): Promise<string | null> {
    if (!parentId) return null;

    const parent = await prisma.comment.findFirst({
      where: { id: parentId, fessId },
      select: { id: true, parentId: true },
    });
    if (!parent) fail('Komentar yang dibalas tidak ditemukan', 404, 'PARENT_NOT_FOUND');

    return parent.parentId || parent.id;
  }

  /**
   * `requireAuth` hanya membawa handle base. Nama base diambil di sini agar
   * komentar Base Admin tampil sebagai nama base, bukan username pribadinya.
   */
  private static async resolveNewCommentAuthor(
    currentUser: CommentViewer | undefined,
    fess: CommentFess
  ): Promise<ResolvedCommentAuthor> {
    if (!currentUser) return { name: 'Anonim', avatar: null, color: null };

    const bases =
      currentUser.role === 'Base Admin' && (currentUser.managedBases || []).length
        ? await prisma.base.findMany({
            where: {
              handle: { in: currentUser.managedBases },
            },
            select: { id: true, name: true, handle: true, avatar: true, color: true, initial: true },
            orderBy: { createdAt: 'asc' },
          })
        : [];

    return resolveCommentAuthor(
      {
        id: currentUser.id,
        username: currentUser.username,
        role: currentUser.role,
        managedBases: bases,
      },
      fess
    );
  }

  private static async loadCommentForWrite(fessId: string, commentId: string) {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, fessId: true, userId: true, author: true, text: true },
    });

    if (!comment || comment.fessId !== fessId) fail('Komentar tidak ditemukan', 404, 'NOT_FOUND');

    const fess = await prisma.fess.findUnique({
      where: { id: fessId },
      select: { id: true, baseId: true, baseHandle: true },
    });
    if (!fess) fail('Fess tidak ditemukan', 404, 'NOT_FOUND');

    return { comment, fess };
  }

  /** Edit komentar milik sendiri. Moderator tidak boleh mengubah kata pengguna. */
  static async updateComment(
    fessId: string,
    commentId: string,
    text: string,
    currentUser: CommentViewer
  ) {
    const { comment } = await CommentService.loadCommentForWrite(fessId, commentId);

    if (comment.userId !== currentUser.id) {
      fail('Kamu hanya bisa mengubah komentar milikmu sendiri.', 403, 'FORBIDDEN');
    }

    const updated = await prisma.comment.update({
      where: { id: comment.id },
      data: { text: text.trim() },
    });

    return {
      id: updated.id,
      author: updated.author,
      text: updated.text,
      created_at: new Date(updated.createdAt).getTime(),
      is_mine: true,
      can_edit: true,
      can_delete: true,
    };
  }

  /** Hapus komentar: penulis sendiri, Base Admin pengelola base, atau Super Admin. */
  static async deleteComment(fessId: string, commentId: string, currentUser: CommentViewer) {
    const { comment, fess } = await CommentService.loadCommentForWrite(fessId, commentId);

    const isAuthor = comment.userId === currentUser.id;
    if (!isAuthor && !canModerate(currentUser, fess)) {
      fail('Kamu tidak berwenang menghapus komentar ini.', 403, 'FORBIDDEN');
    }

    await prisma.$transaction([
      prisma.comment.delete({ where: { id: comment.id } }),
      // Guard `gt: 0` supaya data lama yang tidak konsisten tidak menghasilkan
      // komentar terhitung negatif.
      prisma.fess.updateMany({
        where: { id: fessId, commentsCount: { gt: 0 } },
        data: { commentsCount: { decrement: 1 } },
      }),
    ]);

    return { id: comment.id, deleted: true };
  }
}