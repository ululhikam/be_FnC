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
import { generateToken, verifyToken } from '../utils/jwt.util.js';
import { ENV } from '../config/env.js';
import { InstagramService } from '../services/instagram.service.js';
import { prisma } from '../config/prisma.js';

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

// Meta Instagram OAuth 2.0 Flow (Redirect to Meta Instagram & Callback)
router.get('/instagram', (req, res) => {
  if (!ENV.INSTAGRAM_CLIENT_ID || !ENV.INSTAGRAM_CLIENT_SECRET) {
    return res.redirect(`${ENV.FRONTEND_URL}/base-admin?error=instagram_not_configured`);
  }

  // Token JWT admin yang sedang login bisa dioper via query parameter
  let userId = '';
  const tokenParam = (req.query.token as string) || '';
  if (tokenParam) {
    try {
      const decoded: any = verifyToken(tokenParam);
      userId = decoded?.sub || '';
    } catch {
      // Ignored
    }
  }

  const statePayload = Buffer.from(
    JSON.stringify({
      userId,
      baseHandle: req.query.base || '',
      origin: req.query.origin || 'connections',
    })
  ).toString('base64url');

  const authUrl = InstagramService.getAuthorizationUrl(statePayload);
  res.redirect(authUrl);
});

router.get('/instagram/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    const error = req.query.error as string;
    const errorDesc = req.query.error_description as string;

    if (error || !code) {
      return res.redirect(
        `${ENV.FRONTEND_URL}/base-admin?panel=connections&error=${encodeURIComponent(errorDesc || 'Koneksi Instagram dibatalkan.')}`
      );
    }

    // Decode state
    let stateData: any = {};
    if (req.query.state) {
      try {
        stateData = JSON.parse(Buffer.from(String(req.query.state), 'base64url').toString('utf-8'));
      } catch {
        // Ignored
      }
    }

    let targetUserId = stateData.userId;

    if (!targetUserId) {
      // Login via Instagram
      const shortToken = await InstagramService.exchangeCodeForToken(code);
      const longToken = await InstagramService.getLongLivedToken(shortToken);
      const profile = await InstagramService.verifyToken(longToken);

      let user = await prisma.user.findUnique({
        where: { instagramId: profile.id },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            instagramId: profile.id,
            igAccount: profile.username,
            username: profile.username.replace(/^@/, '') || 'IG User',
            handle: profile.username,
            role: 'Base Admin',
            bio: `Official verified Instagram account: ${profile.username}`,
          },
        });
      }

      targetUserId = user.id;

      // Link PlatformConnection
      await prisma.platformConnection.upsert({
        where: {
          userId_platform: {
            userId: user.id,
            platform: 'instagram',
          },
        },
        create: {
          userId: user.id,
          platform: 'instagram',
          name: 'Instagram Graph API (Canvas Story)',
          status: 'connected',
          connected: true,
          accountHandle: profile.username,
          accessToken: longToken,
        },
        update: {
          status: 'connected',
          connected: true,
          accountHandle: profile.username,
          accessToken: longToken,
        },
      });

      const authToken = generateToken({
        sub: user.id,
        role: user.role,
        handle: user.handle,
        email: user.email || undefined,
      });

      return res.redirect(
        `${ENV.FRONTEND_URL}/base-admin?token=${authToken}&ig_connected=true&ig_user=${encodeURIComponent(profile.username)}`
      );
    }

    // Sambungkan akun Instagram ke admin yang sudah login
    const result = await InstagramService.verifyAndLinkAccount(targetUserId, {
      code,
      baseHandle: stateData.baseHandle,
    });

    return res.redirect(
      `${ENV.FRONTEND_URL}/base-admin?panel=connections&ig_connected=true&ig_user=${encodeURIComponent(result.profile.username)}`
    );
  } catch (err: any) {
    console.error('[Instagram OAuth Callback Error]:', err.message);
    return res.redirect(
      `${ENV.FRONTEND_URL}/base-admin?panel=connections&error=${encodeURIComponent(err.message || 'Gagal menghubungkan Instagram')}`
    );
  }
});

export default router;
