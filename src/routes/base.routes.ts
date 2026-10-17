import { Router } from 'express';
import { BaseController } from '../controllers/base.controller.js';
import { optionalAuth, requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validateBody, validateQuery } from '../middlewares/validate.middleware.js';
import {
  GetBasesQuerySchema,
  BaseFessesQuerySchema,
  BaseFollowersQuerySchema,
  CreateBaseSchema,
  UpdateBaseSettingsSchema,
} from '../validators/base.validator.js';

const router = Router();

router.get('/', optionalAuth, validateQuery(GetBasesQuerySchema), BaseController.getBases);
router.post(
  '/',
  requireAuth,
  requireRole('Base Admin', 'Super Admin'),
  validateBody(CreateBaseSchema),
  BaseController.createBase
);
router.get('/:handle', optionalAuth, BaseController.getBase);
router.post('/:handle/follow', requireAuth, BaseController.followBase);
router.get('/:handle/fesses', optionalAuth, validateQuery(BaseFessesQuerySchema), BaseController.getBaseFesses);
router.get(
  '/:handle/followers',
  optionalAuth,
  validateQuery(BaseFollowersQuerySchema),
  BaseController.getBaseFollowers
);
router.patch(
  '/:handle/settings',
  requireAuth,
  requireRole('Base Admin', 'Super Admin'),
  validateBody(UpdateBaseSettingsSchema),
  BaseController.updateBaseSettings
);

export default router;
