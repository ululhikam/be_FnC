import { Router } from 'express';
import { FessController } from '../controllers/fess.controller.js';
import { CommentController } from '../controllers/comment.controller.js';
import {
  optionalAuth,
  requireAuth,
  requireBaseAdmin,
} from '../middlewares/auth.middleware.js';
import { validateBody, validateQuery } from '../middlewares/validate.middleware.js';
import {
  CanvasPreviewSchema,
  CreateFessSchema,
  GetFessesQuerySchema,
  VoteSchema,
  ReportSchema,
  ReportActionSchema,
  ManualIgPostSchema,
} from '../validators/fess.validator.js';
import { AddCommentSchema, GetCommentsQuerySchema } from '../validators/comment.validator.js';

const router = Router();

router.get('/', optionalAuth, validateQuery(GetFessesQuerySchema), FessController.getFesses);
router.post('/', optionalAuth, validateBody(CreateFessSchema), FessController.createFess);
// Pratinjau kartu untuk modal konfirmasi posting (tanpa menyimpan apa pun).
router.post(
  '/canvas/preview',
  optionalAuth,
  validateBody(CanvasPreviewSchema),
  FessController.previewCanvas
);
router.get('/:id/instagram-status', optionalAuth, FessController.getInstagramStatus);
router.get('/:id', optionalAuth, FessController.getFess);
router.post('/:id/vote', requireAuth, validateBody(VoteSchema), FessController.voteFess);
router.post('/:id/bookmark', requireAuth, FessController.bookmarkFess);
router.delete('/:id/bookmark', requireAuth, FessController.unbookmarkFess);
router.post(
  '/:id/approve',
  requireAuth,
  requireBaseAdmin,
  FessController.approveFess
);
router.post(
  '/:id/reject',
  requireAuth,
  requireBaseAdmin,
  FessController.rejectFess
);
router.post('/:id/report', requireAuth, validateBody(ReportSchema), FessController.reportFess);
router.get(
  '/:id/reports',
  requireAuth,
  requireBaseAdmin,
  FessController.getFessReports
);
router.post(
  '/:id/reports/dismiss',
  requireAuth,
  requireBaseAdmin,
  validateBody(ReportActionSchema),
  FessController.dismissFessReport
);
router.post(
  '/:id/reports/resolve',
  requireAuth,
  requireBaseAdmin,
  validateBody(ReportActionSchema),
  FessController.resolveFessReport
);
router.delete('/:id/delete', requireAuth, FessController.deleteFess);
router.post(
  '/:id/instagram-post',
  requireAuth,
  requireBaseAdmin,
  FessController.postToInstagram
);
router.post(
  '/:id/manual-ig-post',
  requireAuth,
  requireBaseAdmin,
  validateBody(ManualIgPostSchema),
  FessController.manualIgPost
);

// Nested Comments Endpoints
router.get('/:id/comments', optionalAuth, validateQuery(GetCommentsQuerySchema), CommentController.getComments);
router.post('/:id/comments', requireAuth, validateBody(AddCommentSchema), CommentController.addComment);

export default router;
