import { Router } from 'express';
import { UserController } from '../controllers/user.controller.js';
import { requireAuth, optionalAuth } from '../middlewares/auth.middleware.js';
import { validateBody, validateQuery } from '../middlewares/validate.middleware.js';
import { UpdateProfileSchema, UserFessesQuerySchema, FollowingBasesQuerySchema } from '../validators/user.validator.js';

const router = Router();

router.patch('/me', requireAuth, validateBody(UpdateProfileSchema), UserController.updateProfile);
router.get('/me/fesses', requireAuth, validateQuery(UserFessesQuerySchema), UserController.getMyFesses);
router.get(
  '/me/following',
  requireAuth,
  validateQuery(FollowingBasesQuerySchema),
  UserController.getFollowingBases
);
router.get('/:userId', optionalAuth, UserController.getProfile);

export default router;
