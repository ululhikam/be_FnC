import { Router } from 'express';
import { UploadController } from '../controllers/upload.controller.js';
import { uploadSingleMedia } from '../middlewares/upload.middleware.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Unggahan media tidak boleh anonim: tanpa login, bucket publik menjadi hosting
// gratis untuk siapa pun (biaya storage/egress + risiko konten ilegal).
// Sesi tetap boleh belum verifikasi email agar onboarding base (termasuk akun
// Instagram tanpa email) tidak putus; kuota per-user menyusul lewat RateLimit.
router.post('/', requireAuth, uploadSingleMedia, UploadController.uploadMedia);
router.post('/sign', requireAuth, UploadController.signMediaUpload);
router.post('/avatar', requireAuth, uploadSingleMedia, UploadController.uploadAvatar);

export default router;
