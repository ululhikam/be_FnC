import { z } from 'zod';
import { AvatarSchema } from './avatar.validator.js';

export const UpdateProfileSchema = z.object({
  username: z.string().min(3).max(30).optional(),
  handle: z
    .string()
    .trim()
    .regex(
      /^@?[a-zA-Z0-9_.]{3,20}$/,
      'Handle harus 3-20 karakter (huruf, angka, underscore, atau titik)'
    )
    .optional(),
  bio: z.string().max(160).optional().nullable(),
  avatar: AvatarSchema,
});

export const UserFessesQuerySchema = z.object({
  status: z.enum(['published', 'pending', 'rejected']).optional(),
  sort: z.enum(['newest', 'popular']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const FollowingBasesQuerySchema = z.object({
  search: z.string().optional(),
  sort: z.enum(['newest', 'name', 'members']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
