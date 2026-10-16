import { Router } from 'express';
import { InternalController } from '../controllers/internal.controller.js';

const router = Router();

router.post('/instagram/finalize', InternalController.finalizeInstagramPost);

export default router;
