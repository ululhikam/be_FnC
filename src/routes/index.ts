import { Router } from 'express';
import authRoutes from './auth.routes.js';
import baseRoutes from './base.routes.js';
import fessRoutes from './fess.routes.js';
import notificationRoutes from './notification.routes.js';
import userRoutes from './user.routes.js';
import uploadRoutes from './upload.routes.js';
import songRoutes from './song.routes.js';
import topicRoutes from './topic.routes.js';
import adminRoutes from './admin.routes.js';
import paymentRoutes from './payment.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/bases', baseRoutes);
router.use('/fesses', fessRoutes);
router.use('/notifications', notificationRoutes);
router.use('/users', userRoutes);
router.use('/upload', uploadRoutes);
router.use('/songs', songRoutes);
router.use('/topics', topicRoutes);
router.use('/admin', adminRoutes);
router.use('/payments', paymentRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
