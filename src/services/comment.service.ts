import { prisma } from '../config/prisma.js';

export class CommentService {
  /**
   * Get comments for a fess
   */
  static async getComments(fessId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    // Dua query ini tidak saling bergantung. Jalankan paralel agar daftar
    // komentar tidak menunggu query validasi fess lebih dulu.
    const [fess, comments] = await Promise.all([
      prisma.fess.findUnique({ where: { id: fessId }, select: { id: true } }),
      prisma.comment.findMany({
        where: { fessId },
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const data = comments.map((c) => ({
      id: c.id,
      author: c.author,
      text: c.text,
      created_at: new Date(c.createdAt).getTime(),
    }));

    return { data };
  }

  /**
   * Add comment to a fess
   */
  static async addComment(
    fessId: string,
    text: string,
    currentUser?: { id: string; username: string }
  ) {
    const fess = await prisma.fess.findUnique({ where: { id: fessId } });
    if (!fess) {
      const err: any = new Error('Fess tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const authorName = currentUser?.username || 'Anon_Reader';

    const [comment] = await prisma.$transaction([
      prisma.comment.create({
        data: {
          fessId,
          userId: currentUser?.id || null,
          author: authorName,
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
          actor: authorName,
          text: `membalas fessmu: "${text.slice(0, 40)}${text.length > 40 ? '...' : ''}"`,
        },
      });
    }

    return {
      id: comment.id,
      author: comment.author,
      text: comment.text,
      created_at: new Date(comment.createdAt).getTime(),
    };
  }
}
