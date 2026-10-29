import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller.js';
import { BaseRevenueController } from '../controllers/base-revenue.controller.js';
import { CouponController } from '../controllers/coupon.controller.js';
import { PlatformAdminController } from '../controllers/platform-admin.controller.js';
import { PaymentPackageController } from '../controllers/payment-package.controller.js';
import { TemplateAdminController } from '../controllers/template-admin.controller.js';
import {
  requireAuth,
  requireRole,
  requireBaseAdmin,
} from '../middlewares/auth.middleware.js';
import { validateBody, validateQuery } from '../middlewares/validate.middleware.js';
import { paymentRateLimit } from '../services/rate-limit.service.js';
import {
  CanvasExportSchema,
  PlatformConnectionSchema,
  TreasuryPayoutSchema,
  BasePayoutRequestSchema,
  BasePayoutReviewSchema,
  BaseBankDetailsSchema,
  BaseKycSchema,
  BaseFreeForeverSchema,
  BasePayoutQueueQuerySchema,
  ModerationQueueQuerySchema,
  SystemLogsQuerySchema,
  AdminAuditLogsQuerySchema,
  AdminUsersQuerySchema,
  AdminBanUserSchema,
  AdminUnbanUserSchema,
  AdminPaymentOrdersQuerySchema,
  AdminPaymentEventsQuerySchema,
  AdminPaymentPackageCreateSchema,
  AdminPaymentPackageUpdateSchema,
  AdminPaymentPackageStatusSchema,
  AdminCouponCreateSchema,
  AdminCouponUpdateSchema,
  AdminCouponStatusSchema,
  FessAnalyticsQuerySchema,
} from '../validators/admin.validator.js';
import {
  CreateTemplateSchema,
  ReplaceTemplateSvgSchema,
  SuggestTemplateMetadataSchema,
  UpdateTemplateSchema,
} from '../validators/template-admin.validator.js';

const router = Router();

// Base Admin Dashboard
router.get(
  '/stats',
  requireAuth,
  requireBaseAdmin,
  AdminController.getStats
);

router.get(
  '/stats/fess-analytics',
  requireAuth,
  requireBaseAdmin,
  validateQuery(FessAnalyticsQuerySchema),
  AdminController.getFessAnalytics
);

router.get(
  '/moderation',
  requireAuth,
  requireBaseAdmin,
  validateQuery(ModerationQueueQuerySchema),
  AdminController.getModerationQueue
);

router.post(
  '/canvas/export',
  requireAuth,
  requireBaseAdmin,
  validateBody(CanvasExportSchema),
  AdminController.exportCanvas
);

// Platform Connections (Base Admin)
router.get(
  '/connections',
  requireAuth,
  requireBaseAdmin,
  AdminController.getPlatformConnections
);

// Instagram Insights (Base Admin)
router.get(
  '/instagram-insights',
  requireAuth,
  requireBaseAdmin,
  AdminController.getInstagramInsights
);

router.get(
  '/instagram-media-insights',
  requireAuth,
  requireBaseAdmin,
  AdminController.getInstagramMediaInsights
);

router.post(
  '/connections/:platform',
  requireAuth,
  requireBaseAdmin,
  validateBody(PlatformConnectionSchema),
  AdminController.togglePlatformConnection
);

// Treasury & Payout (Base Admin)
router.get(
  '/treasury',
  requireAuth,
  requireBaseAdmin,
  AdminController.getTreasury
);

// Base revenue & IDR payout workflow (separate from the user's CTF wallet).
router.get(
  '/base-revenue',
  requireAuth,
  requireRole('Base Admin', 'Super Admin'),
  BaseRevenueController.getWorkspace
);

router.get(
  '/base-revenue/payouts',
  requireAuth,
  requireRole('Base Admin', 'Super Admin'),
  validateQuery(BasePayoutQueueQuerySchema),
  BaseRevenueController.listPayouts
);

router.post(
  '/base-revenue/payouts',
  requireAuth,
  requireBaseAdmin,
  paymentRateLimit({
    name: 'payout-request',
    limit: 5,
    windowSeconds: 60,
    message: 'Terlalu banyak permintaan payout. Coba lagi beberapa saat.',
    code: 'PAYOUT_RATE_LIMITED',
  }),
  validateBody(BasePayoutRequestSchema),
  BaseRevenueController.requestPayout
);

router.post(
  '/base-revenue/payouts/:id/review',
  requireAuth,
  requireRole('Super Admin'),
  paymentRateLimit({
    name: 'payout-review',
    limit: 20,
    windowSeconds: 60,
    message: 'Terlalu banyak aksi review payout. Coba lagi beberapa saat.',
    code: 'PAYOUT_REVIEW_RATE_LIMITED',
  }),
  validateBody(BasePayoutReviewSchema),
  BaseRevenueController.reviewPayout
);

router.put(
  '/base-revenue/bank',
  requireAuth,
  requireBaseAdmin,
  paymentRateLimit({
    name: 'payout-bank',
    limit: 10,
    windowSeconds: 60,
    message: 'Terlalu banyak perubahan rekening. Coba lagi beberapa saat.',
    code: 'PAYOUT_BANK_RATE_LIMITED',
  }),
  validateBody(BaseBankDetailsSchema),
  BaseRevenueController.updateBank
);

router.post(
  '/base-revenue/kyc',
  requireAuth,
  requireRole('Super Admin'),
  paymentRateLimit({
    name: 'payout-kyc',
    limit: 20,
    windowSeconds: 60,
    message: 'Terlalu banyak aksi KYC. Coba lagi beberapa saat.',
    code: 'PAYOUT_KYC_RATE_LIMITED',
  }),
  validateBody(BaseKycSchema),
  BaseRevenueController.setKyc
);

router.post(
  '/base-revenue/free-forever',
  requireAuth,
  requireRole('Super Admin'),
  paymentRateLimit({
    name: 'free-forever',
    limit: 10,
    windowSeconds: 60,
    message: 'Terlalu banyak perubahan freeForever. Coba lagi beberapa saat.',
    code: 'FREE_FOREVER_RATE_LIMITED',
  }),
  validateBody(BaseFreeForeverSchema),
  BaseRevenueController.setFreeForever
);

router.post(
  '/treasury/payout',
  requireAuth,
  requireBaseAdmin,
  validateBody(TreasuryPayoutSchema),
  AdminController.requestPayout
);

// ---------------------------------------------------------------------------
// Super Admin platform console (read models + guarded account actions)
// ---------------------------------------------------------------------------

// Template kartu: import SVG, thumbnail otomatis, metadata & pemilik base.
router.get(
  '/templates',
  requireAuth,
  requireRole('Super Admin'),
  TemplateAdminController.list
);

router.post(
  '/templates',
  requireAuth,
  requireRole('Super Admin'),
  paymentRateLimit({
    name: 'template-admin-create',
    limit: 20,
    windowSeconds: 60,
    message: 'Terlalu banyak import template. Coba lagi beberapa saat.',
    code: 'TEMPLATE_RATE_LIMITED',
  }),
  validateBody(CreateTemplateSchema),
  TemplateAdminController.create
);

router.post(
  '/templates/suggest-metadata',
  requireAuth,
  requireRole('Super Admin'),
  paymentRateLimit({
    name: 'template-admin-suggest',
    limit: 10,
    windowSeconds: 60,
    message: 'Terlalu banyak permintaan usulan AI. Coba lagi beberapa saat.',
    code: 'TEMPLATE_AI_RATE_LIMITED',
  }),
  validateBody(SuggestTemplateMetadataSchema),
  TemplateAdminController.suggestMetadata
);

router.patch(
  '/templates/:key',
  requireAuth,
  requireRole('Super Admin'),
  validateBody(UpdateTemplateSchema),
  TemplateAdminController.update
);

router.put(
  '/templates/:key/svg',
  requireAuth,
  requireRole('Super Admin'),
  paymentRateLimit({
    name: 'template-admin-replace',
    limit: 20,
    windowSeconds: 60,
    message: 'Terlalu banyak penggantian SVG. Coba lagi beberapa saat.',
    code: 'TEMPLATE_RATE_LIMITED',
  }),
  validateBody(ReplaceTemplateSvgSchema),
  TemplateAdminController.replaceSvg
);

router.post(
  '/templates/:key/thumbnail',
  requireAuth,
  requireRole('Super Admin'),
  paymentRateLimit({
    name: 'template-admin-thumbnail',
    limit: 20,
    windowSeconds: 60,
    message: 'Terlalu banyak render thumbnail. Coba lagi beberapa saat.',
    code: 'TEMPLATE_RATE_LIMITED',
  }),
  TemplateAdminController.regenerateThumbnail
);

router.delete(
  '/templates/:key',
  requireAuth,
  requireRole('Super Admin'),
  TemplateAdminController.archive
);

router.get(
  '/ops/summary',
  requireAuth,
  requireRole('Super Admin'),
  PlatformAdminController.getSummary
);

router.get(
  '/audit-logs',
  requireAuth,
  requireRole('Super Admin'),
  validateQuery(AdminAuditLogsQuerySchema),
  PlatformAdminController.getAuditLogs
);

router.get(
  '/users',
  requireAuth,
  requireRole('Super Admin'),
  validateQuery(AdminUsersQuerySchema),
  PlatformAdminController.getUsers
);

router.post(
  '/users/:id/ban',
  requireAuth,
  requireRole('Super Admin'),
  paymentRateLimit({
    name: 'admin-user-ban',
    limit: 20,
    windowSeconds: 60,
    message: 'Terlalu banyak aksi ban. Coba lagi beberapa saat.',
    code: 'ADMIN_BAN_RATE_LIMITED',
  }),
  validateBody(AdminBanUserSchema),
  PlatformAdminController.banUser
);

router.post(
  '/users/:id/unban',
  requireAuth,
  requireRole('Super Admin'),
  paymentRateLimit({
    name: 'admin-user-unban',
    limit: 20,
    windowSeconds: 60,
    message: 'Terlalu banyak aksi unban. Coba lagi beberapa saat.',
    code: 'ADMIN_UNBAN_RATE_LIMITED',
  }),
  validateBody(AdminUnbanUserSchema),
  PlatformAdminController.unbanUser
);

router.get(
  '/bases/:handle/support',
  requireAuth,
  requireRole('Super Admin'),
  PlatformAdminController.getBaseSupport
);

router.get(
  '/payments/orders',
  requireAuth,
  requireRole('Super Admin'),
  validateQuery(AdminPaymentOrdersQuerySchema),
  PlatformAdminController.getPaymentOrders
);

router.get(
  '/payments/orders/:id',
  requireAuth,
  requireRole('Super Admin'),
  PlatformAdminController.getPaymentOrder
);

router.get(
  '/payments/events',
  requireAuth,
  requireRole('Super Admin'),
  validateQuery(AdminPaymentEventsQuerySchema),
  PlatformAdminController.getPaymentEvents
);

// ---------------------------------------------------------------------------
// Paket top-up CTF: satu-satunya bagian pembayaran yang bisa ditulis admin.
// Nominal & CTF per paket aman diubah karena PaymentOrder menyimpan snapshot.
// ---------------------------------------------------------------------------
router.get(
  '/payments/packages',
  requireAuth,
  requireRole('Super Admin'),
  PaymentPackageController.list
);

router.post(
  '/payments/packages',
  requireAuth,
  requireRole('Super Admin'),
  paymentRateLimit({
    name: 'payment-package-create',
    limit: 20,
    windowSeconds: 60,
    message: 'Terlalu banyak perubahan paket top-up. Coba lagi beberapa saat.',
    code: 'PAYMENT_PACKAGE_RATE_LIMITED',
  }),
  validateBody(AdminPaymentPackageCreateSchema),
  PaymentPackageController.create
);

router.patch(
  '/payments/packages/:code',
  requireAuth,
  requireRole('Super Admin'),
  paymentRateLimit({
    name: 'payment-package-update',
    limit: 20,
    windowSeconds: 60,
    message: 'Terlalu banyak perubahan paket top-up. Coba lagi beberapa saat.',
    code: 'PAYMENT_PACKAGE_RATE_LIMITED',
  }),
  validateBody(AdminPaymentPackageUpdateSchema),
  PaymentPackageController.update
);

router.post(
  '/payments/packages/:code/status',
  requireAuth,
  requireRole('Super Admin'),
  paymentRateLimit({
    name: 'payment-package-status',
    limit: 20,
    windowSeconds: 60,
    message: 'Terlalu banyak perubahan status paket. Coba lagi beberapa saat.',
    code: 'PAYMENT_PACKAGE_RATE_LIMITED',
  }),
  validateBody(AdminPaymentPackageStatusSchema),
  PaymentPackageController.setStatus
);

// ---------------------------------------------------------------------------
// Kupon promo top-up: mengubah uang yang ditagih, jadi setiap mutasi wajib
// re-auth + alasan dan dicatat di audit.
// ---------------------------------------------------------------------------
router.get(
  '/payments/coupons',
  requireAuth,
  requireRole('Super Admin'),
  CouponController.list
);

router.post(
  '/payments/coupons',
  requireAuth,
  requireRole('Super Admin'),
  paymentRateLimit({
    name: 'coupon-create',
    limit: 20,
    windowSeconds: 60,
    message: 'Terlalu banyak perubahan kupon. Coba lagi beberapa saat.',
    code: 'COUPON_RATE_LIMITED',
  }),
  validateBody(AdminCouponCreateSchema),
  CouponController.create
);

router.patch(
  '/payments/coupons/:code',
  requireAuth,
  requireRole('Super Admin'),
  paymentRateLimit({
    name: 'coupon-update',
    limit: 20,
    windowSeconds: 60,
    message: 'Terlalu banyak perubahan kupon. Coba lagi beberapa saat.',
    code: 'COUPON_RATE_LIMITED',
  }),
  validateBody(AdminCouponUpdateSchema),
  CouponController.update
);

router.post(
  '/payments/coupons/:code/status',
  requireAuth,
  requireRole('Super Admin'),
  paymentRateLimit({
    name: 'coupon-status',
    limit: 20,
    windowSeconds: 60,
    message: 'Terlalu banyak perubahan status kupon. Coba lagi beberapa saat.',
    code: 'COUPON_RATE_LIMITED',
  }),
  validateBody(AdminCouponStatusSchema),
  CouponController.setStatus
);

router.get(
  '/system/settings',
  requireAuth,
  requireRole('Super Admin'),
  PlatformAdminController.getSystemSettings
);

// Super Admin System Monitoring & Security Controls
router.get(
  '/system/health',
  requireAuth,
  requireRole('Super Admin'),
  AdminController.getSystemHealth
);

router.get(
  '/system/logs',
  requireAuth,
  requireRole('Super Admin'),
  validateQuery(SystemLogsQuerySchema),
  AdminController.getEngineLogs
);

export default router;
