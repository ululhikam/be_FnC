import { Router } from 'express';
import { SongController } from '../controllers/song.controller.js';
import { validateQuery } from '../middlewares/validate.middleware.js';
import { SongsQuerySchema } from '../validators/admin.validator.js';

const router = Router();

router.get('/', validateQuery(SongsQuerySchema), SongController.getSongs);

export default router;
