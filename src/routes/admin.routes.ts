import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller.js';
import { BaseRevenueController } from '../controllers/base-revenue.controller.js';
import { PlatformAdminController } from '../controllers/platform-admin.controller.js';
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
} from '../validators/admin.validator.js';

const router = Router();

// Base Admin Dashboard
router.get(
  '/stats',
  requireAuth,
  requireBaseAdmin,
  AdminController.getStats
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
