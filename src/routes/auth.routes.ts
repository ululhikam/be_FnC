import { Router, Request, Response } from 'express';
import passport from 'passport';
import { AuthController } from '../controllers/auth.controller.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import {
  LoginSchema,
  RegisterUserSchema,
  RegisterBaseSchema,
  GoogleAuthSchema,
  InstagramVerifySchema,
  ForgotPasswordSchema,
  VerifyResetOtpSchema,
  ResetPasswordSchema,
} from '../validators/auth.validator.js';
import { generateToken } from '../utils/jwt.util.js';
import { ENV } from '../config/env.js';

const router = Router();

// Standard API Contract Endpoints
router.post('/login', validateBody(LoginSchema), AuthController.login);
router.post('/login/google', validateBody(GoogleAuthSchema), AuthController.loginGoogle);
router.post('/register/user', validateBody(RegisterUserSchema), AuthController.registerUser);
router.post('/register/base', validateBody(RegisterBaseSchema), AuthController.registerBase);
router.post('/logout', requireAuth, AuthController.logout);
router.get('/me', requireAuth, AuthController.getMe);
router.post('/refresh', requireAuth, AuthController.refreshToken);

// Reset kata sandi via kode OTP email (3 langkah, tanpa sesi login)
router.post('/forgot-password', validateBody(ForgotPasswordSchema), AuthController.forgotPassword);
router.post('/verify-reset-otp', validateBody(VerifyResetOtpSchema), AuthController.verifyResetOtp);
router.post('/reset-password', validateBody(ResetPasswordSchema), AuthController.resetPassword);

// Instagram Verification via Meta for Developers App
router.post('/instagram/verify', requireAuth, validateBody(InstagramVerifySchema), AuthController.verifyInstagram);

// Passport Google OAuth Flow (Redirect to Google & Callback)
router.get('/google', (req, res, next) => {
  if (!ENV.GOOGLE_CLIENT_ID || !ENV.GOOGLE_CLIENT_SECRET) {
    return res.redirect(`${ENV.FRONTEND_URL}/login?error=google_not_configured`);
  }

  // `role` picks which portal the visitor is signing into; it round-trips
  // through Google as the OAuth `state` so the callback can auto-register
  // the account with the right role.
  const role = req.query.role === 'Base Admin' ? 'Base Admin' : 'User';

  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    state: role,
  })(req, res, next);
});

router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${ENV.FRONTEND_URL}/login?error=google_failed` }),
  (req: Request, res: Response) => {
    const user = req.user as any;
    const token = generateToken({
      sub: user.id,
      role: user.role,
      handle: user.handle,
      email: user.email || undefined,
    });
    // Hand the JWT back to the SPA; it then loads the profile via GET /auth/me.
    res.redirect(`${ENV.FRONTEND_URL}/login?google=1&token=${encodeURIComponent(token)}`);
  }
);

// Passport Instagram OAuth Flow (Redirect to Meta Instagram & Callback)
router.get('/instagram', (req, res, next) => {
  passport.authenticate('instagram', {
    session: false,
  })(req, res, next);
});

router.get(
  '/instagram/callback',
  passport.authenticate('instagram', { session: false, failureRedirect: `${ENV.FRONTEND_URL}/register?error=ig_failed` }),
  (req: Request, res: Response) => {
    const user = req.user as any;
    const token = generateToken({
      sub: user.id,
      role: user.role,
      handle: user.handle,
      email: user.email || undefined,
    });
    res.redirect(`${ENV.FRONTEND_URL}/base-admin?token=${token}&ig_connected=true`);
  }
);

export default router;
