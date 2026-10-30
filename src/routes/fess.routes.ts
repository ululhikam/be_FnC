import { Router } from 'express';
import { FessController } from '../controllers/fess.controller.js';
import { CommentController } from '../controllers/comment.controller.js';
import {
  optionalAuth,
  denyBannedSession,
  requireAuth,
  requireBaseAdmin,
} from '../middlewares/auth.middleware.js';
import { quotaRateLimit } from '../services/rate-limit.service.js';
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
import {
  AddCommentSchema,
  EditCommentSchema,
  GetCommentsQuerySchema,
} from '../validators/comment.validator.js';

const router = Router();

router.get('/', optionalAuth, validateQuery(GetFessesQuerySchema), FessController.getFesses);
// Posting menerima pengunjung anonim (mode trial), jadi kuota disimpan di
// Postgres: per IP untuk mencegah satu host membanjiri antrean moderasi, dan
// per akun agar satu akun tidak memutar batas IP lewat banyak jaringan.
router.post(
  '/',
  optionalAuth,
  denyBannedSession,
  quotaRateLimit({
    name: 'create-fess',
    userLimit: 30,
    ipLimit: 20,
    windowSeconds: 60 * 60,
    message: 'Terlalu banyak confession yang dikirim. Coba lagi nanti.',
    code: 'FESS_RATE_LIMITED',
  }),
  validateBody(CreateFessSchema),
  FessController.createFess
);
// Pratinjau kartu untuk modal konfirmasi posting (tanpa menyimpan apa pun).
// Render resvg/sharp mahal secara CPU, jadi kuotanya lebih ketat.
router.post(
  '/canvas/preview',
  optionalAuth,
  denyBannedSession,
  quotaRateLimit({
    name: 'canvas-preview',
    userLimit: 60,
    ipLimit: 30,
    windowSeconds: 10 * 60,
    message: 'Terlalu banyak pratinjau kartu. Tunggu beberapa menit.',
    code: 'CANVAS_RATE_LIMITED',
  }),
  validateBody(CanvasPreviewSchema),
  FessController.previewCanvas
);
router.get('/:id/instagram-status', optionalAuth, FessController.getInstagramStatus);
// Pemulihan thumbnail cover (hanya `failed`/`idle`; judul tidak bisa diedit).
router.post('/:id/thumbnail', requireAuth, FessController.regenerateThumbnail);
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
router.patch(
  '/:id/comments/:commentId',
  requireAuth,
  validateBody(EditCommentSchema),
  CommentController.updateComment
);
router.delete('/:id/comments/:commentId', requireAuth, CommentController.deleteComment);

export default router;
