import { z } from 'zod';

export const CanvasExportSchema = z.object({
  fess_id: z.string().min(1, 'ID fess wajib diisi'),
  template: z
    .enum([
      'spotify',
      'typewriter',
      'journal',
      'locker',
      'clay',
      'default',
      'midnight',
      'sunset',
      'forest',
      'noir',
      'paper',
      'ocean',
      'violet',
    ])
    .default('default'),
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

export const ModerationQueueQuerySchema = z.object({
  base: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const SystemLogsQuerySchema = z.object({
  source: z.enum(['RATE_LIMITER', 'CANVAS_WORKER', 'AUTO_BASE', 'REDIS_CACHE', 'AI_FILTER']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const SongsQuerySchema = z.object({
  query: z.string().optional(),
  genre: z.string().optional(),
  sort: z.enum(['popular', 'newest']).default('popular'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
