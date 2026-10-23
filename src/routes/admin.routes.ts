import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validateBody, validateQuery } from '../middlewares/validate.middleware.js';
import {
  CanvasExportSchema,
  BanUserSchema,
  SecurityControlsSchema,
  PlatformConnectionSchema,
  TreasuryPayoutSchema,
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
