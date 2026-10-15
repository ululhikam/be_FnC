import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { validateBody, validateQuery } from '../middlewares/validate.middleware.js';
import {
  GetNotificationsQuerySchema,
  MarkNotificationsReadSchema,
} from '../validators/notification.validator.js';

const router = Router();

router.get('/', requireAuth, validateQuery(GetNotificationsQuerySchema), NotificationController.getNotifications);
router.post('/read', requireAuth, validateBody(MarkNotificationsReadSchema), NotificationController.markNotificationsRead);
router.post('/read-all', requireAuth, NotificationController.markAllRead);
router.delete('/:id', requireAuth, NotificationController.deleteNotification);

export default router;
