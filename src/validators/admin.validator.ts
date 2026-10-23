import { z } from 'zod';
import { TEMPLATES } from '../constants/templates.js';

/** Semua key template yang valid — otomatis ikut saat template baru ditambah. */
const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key) as [string, ...string[]];

export const CanvasExportSchema = z.object({
  fess_id: z.string().min(1, 'ID fess wajib diisi'),
  template: z.enum(TEMPLATE_KEYS).default('default'),
  aspect: z.enum(['square', 'portrait', 'story']).default('portrait'),
});

export const BanUserSchema = z.object({
  user_id: z.string().min(1, 'ID user wajib diisi'),
  reason: z.string().min(1, 'Alasan ban wajib diisi'),
  duration_hours: z.number().int().min(0).default(0), // 0 = permanent
});

export const SecurityControlsSchema = z.object({
  rate_limit_per_ip: z.number().int().min(1).max(60).optional(),
  ai_filter_active: z.boolean().optional(),
  canvas_worker_running: z.boolean().optional(),
});

export const PlatformConnectionSchema = z.object({
  action: z.enum(['connect', 'disconnect']).optional(),
  account_handle: z.string().optional(),
});

export const TreasuryPayoutSchema = z.object({
  amount: z.number().min(0, 'Jumlah payout tidak boleh negatif'),
  destination: z.string().optional().default('wallet'),
});

export const BasePayoutRequestSchema = z.object({
  amount_idr: z
    .number()
    .int('Nominal payout harus bilangan bulat')
    .min(50_000, 'Minimal penarikan Rp50.000'),
  base_handle: z.string().min(1).max(60).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const BasePayoutReviewSchema = z.object({
  action: z.enum(['approve', 'reject', 'mark_paid', 'mark_failed']),
  password: z.string().min(1).max(200).optional().nullable(),
  reason: z.string().max(500).optional().nullable(),
  fee_idr: z.number().int().min(0).optional(),
  reference: z.string().max(160).optional().nullable(),
});

export const BaseBankDetailsSchema = z.object({
  base_handle: z.string().min(1).max(60).optional().nullable(),
  bank_name: z.string().min(2).max(80),
  bank_account_name: z.string().min(2).max(120),
  bank_account_number: z
    .string()
    .min(5)
    .max(40)
    .regex(/^[0-9\s]+$/, 'Nomor rekening hanya boleh berisi angka'),
  password: z.string().min(1).max(200),
});

export const BaseKycSchema = z.object({
  base_handle: z.string().min(1).max(60),
  status: z.enum(['verified', 'rejected', 'unverified']),
  note: z.string().max(500).optional().nullable(),
  password: z.string().min(1).max(200),
});

export const BaseFreeForeverSchema = z.object({
  base_handle: z.string().min(1).max(60),
  free_forever: z.boolean(),
  reason: z.string().min(5, 'Alasan wajib diisi minimal 5 karakter').max(500),
  password: z.string().min(1).max(200),
});

export const BasePayoutQueueQuerySchema = z.object({
  status: z
    .enum(['requested', 'approved', 'rejected', 'paid', 'failed', 'cancelled'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ModerationQueueQuerySchema = z.object({
  base: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const SystemLogsQuerySchema = z.object({
  source: z
    .enum(['RATE_LIMITER', 'CANVAS_WORKER', 'AUTO_BASE', 'REDIS_CACHE', 'AI_FILTER', 'PAYOUT'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const SongsQuerySchema = z.object({
  query: z.string().optional(),
  genre: z.string().optional(),
  sort: z.enum(['popular', 'newest']).default('popular'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
