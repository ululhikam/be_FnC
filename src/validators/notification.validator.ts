import { z } from 'zod';
import { PageQuerySchema } from './pagination.validator.js';

export const GetNotificationsQuerySchema = z.object({
  type: z.enum(['comment', 'vote', 'mention', 'moderation', 'system']).optional(),
  page: PageQuerySchema,
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const MarkNotificationsReadSchema = z.object({
  ids: z.array(z.string()).min(1, 'Daftar ID notifikasi tidak boleh kosong'),
});
