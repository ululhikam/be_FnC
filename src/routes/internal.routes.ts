import { Router } from 'express';
import { InternalController } from '../controllers/internal.controller.js';

const router = Router();

router.post('/instagram/finalize', InternalController.finalizeInstagramPost);
router.post('/instagram/retry', InternalController.retryInstagramPost);

export default router;
