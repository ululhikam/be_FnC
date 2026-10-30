import { z } from 'zod';
import { PageQuerySchema } from './pagination.validator.js';

/**
 * Isi komentar di-trim SEBELUM panjangnya diperiksa. Tanpa `.trim()` di depan,
 * `"   "` lolos `min(1)` lalu tersimpan sebagai string kosong setelah service
 * memangkas spasi.
 */
const CommentTextSchema = z
  .string()
  .trim()
  .min(1, 'Komentar tidak boleh kosong')
  .max(500, 'Komentar maksimal 500 karakter');

export const AddCommentSchema = z.object({
  text: CommentTextSchema,
});

/** Edit memakai aturan panjang yang sama dengan komentar baru. */
export const EditCommentSchema = AddCommentSchema;

export const GetCommentsQuerySchema = z.object({
  page: PageQuerySchema,
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
