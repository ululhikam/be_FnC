import { Router } from 'express';
import { UploadController } from '../controllers/upload.controller.js';
import { uploadSingleMedia } from '../middlewares/upload.middleware.js';
import { optionalAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/', optionalAuth, uploadSingleMedia, UploadController.uploadMedia);
router.post('/avatar', optionalAuth, uploadSingleMedia, UploadController.uploadAvatar);

export default router;
