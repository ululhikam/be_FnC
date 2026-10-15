import { Router } from 'express';
import { TopicController } from '../controllers/topic.controller.js';

const router = Router();

router.get('/', TopicController.getTopics);

export default router;
