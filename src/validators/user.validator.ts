import { z } from 'zod';

export const UpdateProfileSchema = z.object({
  username: z.string().min(3).max(30).optional(),
  bio: z.string().max(160).optional().nullable(),
  avatar: z.string().url().optional().nullable(),
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
