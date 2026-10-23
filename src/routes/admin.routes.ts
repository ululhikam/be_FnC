import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller.js';
import { BaseRevenueController } from '../controllers/base-revenue.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validateBody, validateQuery } from '../middlewares/validate.middleware.js';
import { paymentRateLimit } from '../services/rate-limit.service.js';
import {
  CanvasExportSchema,
  BanUserSchema,
  SecurityControlsSchema,
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
} from '../validators/admin.validator.js';

const router = Router();

// Base Admin Dashboard
router.get(
  '/stats',
  requireAuth,
  requireRole('Base Admin', 'Super Admin'),
  AdminController.getStats
);

router.get(
  '/moderation',
  requireAuth,
  requireRole('Base Admin', 'Super Admin'),
  validateQuery(ModerationQueueQuerySchema),
  AdminController.getModerationQueue
);

router.post(
  '/canvas/export',
  requireAuth,
  requireRole('Base Admin', 'Super Admin'),
  validateBody(CanvasExportSchema),
  AdminController.exportCanvas
);

// Platform Connections (Base Admin)
router.get(
  '/connections',
  requireAuth,
  requireRole('Base Admin', 'Super Admin'),
  AdminController.getPlatformConnections
);

// Instagram Insights (Base Admin)
router.get(
  '/instagram-insights',
  requireAuth,
  requireRole('Base Admin', 'Super Admin'),
  AdminController.getInstagramInsights
);

router.get(
  '/instagram-media-insights',
  requireAuth,
  requireRole('Base Admin', 'Super Admin'),
  AdminController.getInstagramMediaInsights
);

router.post(
  '/connections/:platform',
  requireAuth,
  requireRole('Base Admin', 'Super Admin'),
  validateBody(PlatformConnectionSchema),
  AdminController.togglePlatformConnection
);

// Treasury & Payout (Base Admin)
router.get(
  '/treasury',
  requireAuth,
  requireRole('Base Admin', 'Super Admin'),
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
  requireRole('Base Admin', 'Super Admin'),
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
  requireRole('Base Admin', 'Super Admin'),
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
  requireRole('Base Admin', 'Super Admin'),
  validateBody(TreasuryPayoutSchema),
  AdminController.requestPayout
);

// Super Admin System Monitoring & Security Controls
router.get(
  '/system/health',
  requireAuth,
  requireRole('Super Admin'),
  AdminController.getSystemHealth
);

router.patch(
  '/system/security',
  requireAuth,
  requireRole('Super Admin'),
  validateBody(SecurityControlsSchema),
  AdminController.updateSecurityControls
);

router.get(
  '/system/logs',
  requireAuth,
  requireRole('Super Admin'),
  validateQuery(SystemLogsQuerySchema),
  AdminController.getEngineLogs
);

router.post(
  '/users/ban',
  requireAuth,
  requireRole('Super Admin'),
  validateBody(BanUserSchema),
  AdminController.banUser
);

export default router;
