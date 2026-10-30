import { z } from 'zod';
import { PageQuerySchema } from './pagination.validator.js';

export const AddCommentSchema = z.object({
  text: z.string().min(1, 'Komentar tidak boleh kosong').max(500, 'Komentar maksimal 500 karakter'),
});

/** Edit memakai aturan panjang yang sama dengan komentar baru. */
export const EditCommentSchema = AddCommentSchema;

export const GetCommentsQuerySchema = z.object({
  page: PageQuerySchema,
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
