import { z } from 'zod';
import { AvatarSchema } from './avatar.validator.js';

export const GetBasesQuerySchema = z.object({
  search: z.string().optional(),
  following: z.enum(['true', 'false']).optional(),
  category: z.enum(['Semua', 'Kampus', 'Kota', 'Hobi', 'Umum']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Create a base for an existing signed-in Base Admin (onboarding wizard).
 * Mirrors the base fields accepted by POST /auth/register/base.
 */
export const CreateBaseSchema = z.object({
  name: z.string().min(3, 'Nama base minimal 3 karakter').max(50, 'Nama base maksimal 50 karakter'),
  handle: z
    .string()
    .regex(/^@?[a-zA-Z0-9_.]{3,20}$/, 'Handle 3-20 karakter (huruf, angka, underscore, atau titik)'),
  category: z.enum(['Kampus', 'Kota', 'Hobi', 'Umum']).default('Umum'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  keyword: z.string().max(30).optional().nullable(),
  bio: z.string().max(300).optional().nullable(),
  avatar: AvatarSchema,
  ig_account: z.string().max(50).optional().nullable(),
  rules: z.array(z.string().max(160)).max(10).optional(),
});

export const UpdateBaseSettingsSchema = z.object({
  name: z.string().min(3).max(50).optional(),
  handle: z.string().regex(/^@?[a-zA-Z0-9_.]{3,20}$/).optional(),
  keywords: z.string().optional().nullable(),
  bio: z.string().max(300).optional().nullable(),
  avatar: AvatarSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  rules: z.array(z.string()).optional(),
  postMode: z.enum(['auto', 'moderated']).optional(),
  // Opt-out thumbnail cover Instagram per base. `auto` = thumbnail + judul AI,
  // `no_ai` = thumbnail tanpa AI, `off` = tanpa thumbnail sama sekali.
  thumbnail_mode: z.enum(['auto', 'no_ai', 'off']).optional(),
  // Blacklist kata milik base — dipakai filter NLP saat mode auto post.
  bannedWords: z
    .array(
      z
        .string()
        .trim()
        .min(2, 'Kata terlarang minimal 2 karakter')
        .max(40, 'Kata terlarang maksimal 40 karakter')
    )
    .max(50, 'Maksimal 50 kata terlarang')
    .optional(),
});

export const BaseFessesQuerySchema = z.object({
  status: z.enum(['published', 'approved', 'pending', 'rejected']).optional(),
  /** Khusus admin base: hanya fess yang memiliki laporan pending. */
  reported: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'popular']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const BaseFollowersQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
