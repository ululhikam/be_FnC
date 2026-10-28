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

/** New path: actor comes from the session; password is a fresh re-auth proof. */
export const AdminBanUserSchema = z.object({
  reason: z.string().min(3, 'Alasan ban wajib diisi minimal 3 karakter').max(500),
  duration_hours: z.number().int().min(0).max(24 * 365).default(0), // 0 = permanent
  password: z.string().min(1, 'Konfirmasi kata sandi wajib diisi').max(200),
});

export const AdminUnbanUserSchema = z.object({
  reason: z.string().max(500).optional().nullable(),
  password: z.string().min(1, 'Konfirmasi kata sandi wajib diisi').max(200),
});

const BooleanQuerySchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

export const AdminAuditLogsQuerySchema = z.object({
  q: z.string().max(120).optional(),
  action: z.string().max(80).optional(),
  target_type: z.string().max(80).optional(),
  actor: z.string().max(120).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const AdminUsersQuerySchema = z.object({
  q: z.string().max(120).optional(),
  role: z.enum(['User', 'Base Admin', 'Super Admin']).optional(),
  banned: BooleanQuerySchema,
  email_verified: BooleanQuerySchema,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const AdminPaymentOrdersQuerySchema = z.object({
  q: z.string().max(120).optional(),
  status: z
    .enum(['PENDING', 'PAID', 'EXPIRED', 'FAILED', 'REFUNDED', 'PARTIAL_REFUND', 'CHARGEBACK'])
    .optional(),
  method: z.string().max(40).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const AdminPaymentEventsQuerySchema = z.object({
  order_id: z.string().max(80).optional(),
  status: z.enum(['RECEIVED', 'PROCESSED', 'IGNORED', 'INVALID_SIGNATURE', 'FAILED']).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Paket top-up: Super Admin boleh mengubah nama, nominal, dan CTF tanpa deploy.
 * Kode paket immutable (dipakai `PaymentOrder.packageCode`) dan divalidasi ketat.
 */
export const AdminPaymentPackageFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Nama paket wajib diisi minimal 2 karakter')
    .max(40, 'Nama paket maksimal 40 karakter'),
  amount_idr: z
    .number()
    .int('Nominal harus bilangan bulat')
    .min(1_000, 'Nominal minimal Rp1.000')
    .max(10_000_000, 'Nominal maksimal Rp10.000.000'),
  ctf_amount: z
    .number()
    .int('Jumlah CTF harus bilangan bulat')
    .min(1, 'Jumlah CTF minimal 1')
    .max(1_000_000, 'Jumlah CTF maksimal 1.000.000'),
  description: z.string().trim().max(160, 'Deskripsi maksimal 160 karakter').default(''),
  sort_order: z.number().int().min(0).max(999).default(0),
  is_active: z.boolean().default(true),
  reason: z
    .string()
    .trim()
    .min(5, 'Alasan wajib diisi minimal 5 karakter')
    .max(500, 'Alasan maksimal 500 karakter'),
  password: z.string().min(1, 'Konfirmasi kata sandi wajib diisi').max(200),
});

export const AdminPaymentPackageCreateSchema = AdminPaymentPackageFieldsSchema.extend({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9_]{3,32}$/,
      'Kode paket 3-32 karakter: huruf kecil, angka, atau garis bawah'
    ),
});

export const AdminPaymentPackageUpdateSchema = AdminPaymentPackageFieldsSchema;

export const AdminPaymentPackageStatusSchema = z.object({
  is_active: z.boolean(),
  reason: z
    .string()
    .trim()
    .min(5, 'Alasan wajib diisi minimal 5 karakter')
    .max(500, 'Alasan maksimal 500 karakter'),
  password: z.string().min(1, 'Konfirmasi kata sandi wajib diisi').max(200),
});

/** Tanggal kupon: ISO string dari UI, atau null bila tanpa batas. */
const CouponDateSchema = z
  .string()
  .trim()
  .max(40)
  .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), 'Tanggal tidak valid')
  .nullable()
  .optional();

/**
 * Kupon promo top-up. Diskon mengurangi harga bayar, bukan jumlah CTF.
 * `max_discount_idr` hanya dipakai untuk diskon persen.
 */
export const AdminCouponFieldsSchema = z
  .object({
    label: z.string().trim().max(60, 'Label maksimal 60 karakter').default(''),
    discount_type: z.enum(['FIXED', 'PERCENT']),
    discount_value: z
      .number()
      .int('Nilai diskon harus bilangan bulat')
      .min(1, 'Nilai diskon minimal 1')
      .max(10_000_000, 'Nilai diskon maksimal 10.000.000'),
    max_discount_idr: z
      .number()
      .int()
      .min(1, 'Batas potongan minimal Rp1')
      .max(10_000_000)
      .nullable()
      .optional(),
    min_amount_idr: z
      .number()
      .int()
      .min(0)
      .max(10_000_000, 'Minimum pembelian maksimal Rp10.000.000')
      .default(0),
    starts_at: CouponDateSchema,
    ends_at: CouponDateSchema,
    max_redemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
    is_active: z.boolean().default(true),
    reason: z
      .string()
      .trim()
      .min(5, 'Alasan wajib diisi minimal 5 karakter')
      .max(500, 'Alasan maksimal 500 karakter'),
    password: z.string().min(1, 'Konfirmasi kata sandi wajib diisi').max(200),
  })
  .refine(
    (data) => data.discount_type !== 'PERCENT' || data.discount_value <= 100,
    { path: ['discount_value'], message: 'Diskon persen maksimal 100' }
  )
  .refine(
    (data) => {
      if (!data.starts_at || !data.ends_at) return true;
      return Date.parse(data.ends_at) > Date.parse(data.starts_at);
    },
    { path: ['ends_at'], message: 'Tanggal berakhir harus setelah tanggal mulai' }
  );

export const AdminCouponCreateSchema = AdminCouponFieldsSchema.and(
  z.object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-Z0-9_-]{3,32}$/,
        'Kode kupon 3-32 karakter: huruf, angka, garis bawah, atau strip'
      ),
  })
);

export const AdminCouponUpdateSchema = AdminCouponFieldsSchema;

export const AdminCouponStatusSchema = z.object({
  is_active: z.boolean(),
  reason: z
    .string()
    .trim()
    .min(5, 'Alasan wajib diisi minimal 5 karakter')
    .max(500, 'Alasan maksimal 500 karakter'),
  password: z.string().min(1, 'Konfirmasi kata sandi wajib diisi').max(200),
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
  base_handle: z.string().max(60).optional(),
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ModerationQueueQuerySchema = z.object({
  base: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const FessAnalyticsQuerySchema = z.object({
  range: z.enum(['day', 'month', 'year']).default('day'),
  baseHandle: z.string().optional(),
  /** Rentang N hari terakhir untuk grafik tren harian & distribusi jam. */
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export const SystemLogsQuerySchema = z.object({
  source: z
    .enum([
      'RATE_LIMITER',
      'CANVAS_WORKER',
      'AUTO_BASE',
      'REDIS_CACHE',
      'AI_FILTER',
      'PAYOUT',
      'SECURITY',
      'MODERATION',
    ])
    .optional(),
  tone: z.enum(['ok', 'info', 'muted', 'error']).optional(),
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const SongsQuerySchema = z.object({
  query: z.string().optional(),
  genre: z.string().optional(),
  sort: z.enum(['popular', 'newest']).default('popular'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
