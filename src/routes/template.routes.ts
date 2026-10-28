import { Router } from 'express';
import { TemplateController } from '../controllers/template.controller.js';

const router = Router();

// Publik: composer butuh daftar template sebelum user login pun (posting anonim).
router.get('/', TemplateController.listTemplates);
router.get('/:key', TemplateController.getTemplate);

export default router;
