import { z } from 'zod';
import { TEMPLATES } from '../constants/templates.js';

/** Semua key template yang valid — otomatis ikut saat template baru ditambah. */
const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key) as [string, ...string[]];

export const MediaItemSchema = z.object({
  // ID stabil dari composer; dipakai token carousel_order "media:<id>".
  id: z.string().min(1).max(80).optional().nullable(),
  type: z.enum(['image', 'video']),
  url: z
    .string()
    .min(1, 'URL media tidak valid')
    .refine(
      (val) => /^https?:\/\//i.test(val) || val.startsWith('data:') || val.startsWith('/'),
      'URL media tidak valid'
    ),
  thumbnail: z
    .string()
    .optional()
    .nullable()
    .refine(
      (val) => !val || /^https?:\/\//i.test(val) || val.startsWith('data:') || val.startsWith('/'),
      'URL thumbnail tidak valid'
    ),
  // Tetap terima string lama (mis. metadata dari klien versi sebelumnya),
  // tetapi utamakan angka agar backend bisa memvalidasi batas 60 detik.
  duration: z.union([z.number().nonnegative(), z.string()]).optional().nullable(),
  // Dimensi hasil normalisasi komposer (video 4:5). Dipakai backend untuk
  // memastikan semua item carousel Instagram punya rasio yang sama.
  width: z.coerce.number().int().positive().optional().nullable(),
  height: z.coerce.number().int().positive().optional().nullable(),
  caption: z.string().optional().nullable(),
});

export const SongAttachmentSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  cover: z.string().url().optional().nullable(),
  preview_url: z.string().optional().nullable(),
});

export const QuotedFessSchema = z.object({
  id: z.union([z.string(), z.number()]),
  handle: z.string(),
  content: z.string(),
  time: z.string().optional().nullable(),
  avatar_bg: z.string().optional().nullable(),
  avatar_text: z.string().optional().nullable(),
});

/** Validasi payload pratinjau kartu (tanpa menyimpan fess / posting). */
export const CanvasPreviewSchema = z.object({
  base_handle: z.string().min(1, 'Base tujuan wajib dipilih'),
  content: z
    .string()
    .min(1, 'Konten confession minimal 1 karakter')
    .max(2000, 'Konten maksimal 2000 karakter'),
  template: z.string().max(40).optional().default('default'),
  tag: z.enum(['Cerita', 'Tanya']).optional().nullable(),
  topic: z.string().trim().max(40).optional().nullable(),
  quoted_fess: z
    .object({
      id: z.union([z.string(), z.number()]).optional().nullable(),
      handle: z.string().optional().nullable(),
      senderHandle: z.string().optional().nullable(),
      content: z.string(),
      time: z.string().optional().nullable(),
      avatar_bg: z.string().optional().nullable(),
      avatar_text: z.string().optional().nullable(),
      avatarBg: z.string().optional().nullable(),
      avatarText: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

export const CreateFessSchema = z.object({
  base_handle: z.string().min(1, 'Base tujuan wajib dipilih'),
  content: z.string().min(1, 'Konten confession minimal 1 karakter').max(2000, 'Konten maksimal 2000 karakter'),
  media: z.array(MediaItemSchema).max(4, 'Maksimal 4 file media').optional().default([]),
  // Urutan slide carousel IG. Contoh: ["media:media_123", "card:0", "card:1"].
  // Kosong = perilaku lama (semua kartu dulu, lalu media).
  carousel_order: z
    .array(
      z
        .string()
        .max(120)
        .regex(/^(card:\d{1,2}|media:.+)$/, 'Token urutan carousel tidak valid')
    )
    .max(10, 'Maksimal 10 slide carousel')
    .optional()
    .default([]),
  topic: z.string().optional().nullable(),
  scheduled_at: z.string().datetime().optional().nullable(),
  song: SongAttachmentSchema.optional().nullable(),
  template: z.enum(TEMPLATE_KEYS).optional().default('default'),
  quoted_fess: QuotedFessSchema.optional().nullable(),
  tag: z.enum(['Cerita', 'Tanya']).optional().nullable(),
  // Optional body fallback for clients that cannot send custom headers.
  // Header `Idempotency-Key` takes precedence in the controller.
  idempotency_key: z.string().min(1).max(180).optional().nullable(),
});

export const GetFessesQuerySchema = z.object({
  base: z.string().optional(),
  // 'approved' = alias istilah tampilan frontend untuk fess terbit ('published');
  // service sudah menanganinya sebagai { in: ['published', 'approved'] }.
  status: z.enum(['published', 'approved', 'pending', 'rejected']).optional(),
  query: z.string().optional(),
  /** Feed "Mengikuti": hanya fess dari base yang diikuti user. */
  following: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'popular']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const VoteSchema = z.object({
  type: z.enum(['up', 'down']),
});

export const ReportSchema = z.object({
  fess_id: z.string().min(1, 'ID fess wajib diisi'),
  reason: z.enum(['spam', 'sara', 'pelecehan', 'dewasa', 'hoaks']),
  note: z.string().max(250, 'Catatan maksimal 250 karakter').optional().nullable(),
});

export const ReportActionSchema = z.object({
  reason: z.string().max(250, 'Catatan maksimal 250 karakter').optional().nullable(),
});

export const ManualIgPostSchema = z.object({
  ig_post_url: z.string().url('URL postingan Instagram tidak valid'),
  note: z.string().max(250, 'Catatan maksimal 250 karakter').optional().nullable(),
});
