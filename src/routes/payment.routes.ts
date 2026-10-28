import { Router } from 'express';
import { CouponController } from '../controllers/coupon.controller.js';
import { PaymentController } from '../controllers/payment.controller.js';
import { requireAuth, requireVerifiedEmail } from '../middlewares/auth.middleware.js';
import { paymentRateLimit } from '../services/rate-limit.service.js';
import { validateBody, validateQuery } from '../middlewares/validate.middleware.js';
import {
  CreatePaymentOrderSchema,
  ListPaymentOrdersQuerySchema,
  PreviewCouponSchema,
} from '../validators/payment.validator.js';

const router = Router();

router.get('/packages', PaymentController.getPackages);

// Pratinjau kupon: menghitung potongan tanpa mengunci kuota. Dibatasi ketat
// supaya kode kupon tidak bisa dienumerasi dengan cepat.
router.post(
  '/coupons/preview',
  requireAuth,
  requireVerifiedEmail,
  paymentRateLimit({ name: 'coupon-preview', limit: 20, windowSeconds: 60 }),
  validateBody(PreviewCouponSchema),
  CouponController.preview
);

router.post(
  '/orders',
  requireAuth,
  requireVerifiedEmail,
  paymentRateLimit({ name: 'create', limit: 5, windowSeconds: 60 }),
  validateBody(CreatePaymentOrderSchema),
  PaymentController.createOrder
);

router.get(
  '/orders',
  requireAuth,
  validateQuery(ListPaymentOrdersQuerySchema),
  PaymentController.listOrders
);

router.get('/orders/:orderId', requireAuth, PaymentController.getOrder);

// Midtrans server-to-server notification. Authentication is the SHA512
// signature, not a bearer token. Keep this route outside requireAuth.
router.post(
  '/midtrans/notification',
  paymentRateLimit({ name: 'notification', limit: 300, windowSeconds: 60 }),
  PaymentController.notification
);

router.post(
  '/reconcile',
  paymentRateLimit({ name: 'reconcile', limit: 10, windowSeconds: 60 }),
  PaymentController.reconcile
);

export default router;
