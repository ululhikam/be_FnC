import { Router, Request, Response } from 'express';
import crypto from 'crypto';
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
import { parseSignedRequest } from '../utils/meta-signed-request.util.js';

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
  const origin = (req.query.origin as string) || 'connections';
  const returnErrorPath =
    origin === 'onboarding'
      ? '/onboarding/base'
      : origin === 'register'
      ? '/register/base'
      : '/base-admin?panel=connections';

  if (!ENV.INSTAGRAM_CLIENT_ID || !ENV.INSTAGRAM_CLIENT_SECRET) {
    const sep = returnErrorPath.includes('?') ? '&' : '?';
    return res.redirect(`${ENV.FRONTEND_URL}${returnErrorPath}${sep}error=instagram_not_configured`);
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
      origin,
    })
  ).toString('base64url');

  const authUrl = InstagramService.getAuthorizationUrl(statePayload);
  res.redirect(authUrl);
});

router.get('/instagram/callback', async (req: Request, res: Response) => {
  let origin = 'connections';
  try {
    const code = req.query.code as string;
    const error = req.query.error as string;
    const errorDesc = req.query.error_description as string;

    // Decode state
    let stateData: any = {};
    if (req.query.state) {
      try {
        stateData = JSON.parse(Buffer.from(String(req.query.state), 'base64url').toString('utf-8'));
      } catch {
        // Ignored
      }
    }

    origin = stateData.origin || 'connections';
    const returnErrorPath =
      origin === 'onboarding'
        ? '/onboarding/base'
        : origin === 'register'
        ? '/register/base'
        : origin === 'login'
        ? '/login'
        : '/base-admin?panel=connections';

    if (error || !code) {
      const sep = returnErrorPath.includes('?') ? '&' : '?';
      return res.redirect(
        `${ENV.FRONTEND_URL}${returnErrorPath}${sep}error=${encodeURIComponent(errorDesc || error || 'Koneksi Instagram dibatalkan.')}`
      );
    }

    let targetUserId = stateData.userId;

    if (!targetUserId) {
      // Login via Instagram
      const shortToken = await InstagramService.exchangeCodeForToken(code);
      const longToken = await InstagramService.getLongLivedToken(shortToken);
      const tokenExpiresAt = new Date(Date.now() + longToken.expiresIn * 1000).toISOString();
      const profile = await InstagramService.verifyToken(longToken.accessToken);

      let user = await prisma.user.findUnique({
        where: { instagramId: profile.id },
      });

      if (!user) {
        const cleanHandle = profile.username.startsWith('@') ? profile.username : `@${profile.username}`;
        user = await prisma.user.findUnique({
          where: { handle: cleanHandle },
        });

        if (user) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              instagramId: profile.id,
              igAccount: cleanHandle,
            },
          });
        }
      }

      if (!user) {
        let candidateHandle = profile.username.startsWith('@') ? profile.username : `@${profile.username}`;
        let counter = 1;
        while (await prisma.user.findUnique({ where: { handle: candidateHandle } })) {
          candidateHandle = `@${profile.username.replace(/^@/, '')}_${counter++}`;
        }

        user = await prisma.user.create({
          data: {
            instagramId: profile.id,
            igAccount: candidateHandle,
            username: profile.username.replace(/^@/, '') || 'IG User',
            handle: candidateHandle,
            role: 'Base Admin',
            bio: `Official verified Instagram account: ${candidateHandle}`,
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
          name: 'Instagram Graph API (Auto-Post Feed & Reels)',
          status: 'connected',
          connected: true,
          accountHandle: user.igAccount || profile.username,
          accessToken: longToken.accessToken,
          metadata: {
            tokenExpiresAt,
            igUserId: String(profile.id),
            igUsername: profile.username,
          },
        },
        update: {
          status: 'connected',
          connected: true,
          accountHandle: user.igAccount || profile.username,
          accessToken: longToken.accessToken,
          metadata: {
            tokenExpiresAt,
            igUserId: String(profile.id),
            igUsername: profile.username,
          },
        },
      });

      const authToken = generateToken({
        sub: user.id,
        role: user.role,
        handle: user.handle,
        email: user.email || undefined,
      });

      if (origin === 'onboarding') {
        return res.redirect(
          `${ENV.FRONTEND_URL}/onboarding/base?token=${encodeURIComponent(authToken)}&ig_connected=true&ig_user=${encodeURIComponent(profile.username)}`
        );
      }
      if (origin === 'register') {
        // OAuth registrasi sudah membuat akun Base Admin. Akun tanpa base
        // harus melanjutkan ke onboarding, bukan kembali ke form registrasi
        // (yang akan langsung diarahkan oleh route guard).
        return res.redirect(
          `${ENV.FRONTEND_URL}/onboarding/base?token=${encodeURIComponent(authToken)}&ig_connected=true&ig_user=${encodeURIComponent(profile.username)}`
        );
      }
      if (origin === 'login') {
        return res.redirect(
          `${ENV.FRONTEND_URL}/login?instagram=1&token=${encodeURIComponent(authToken)}&ig_connected=true&ig_user=${encodeURIComponent(profile.username)}`
        );
      }

      return res.redirect(
        `${ENV.FRONTEND_URL}/login?instagram=1&token=${encodeURIComponent(authToken)}&ig_connected=true&ig_user=${encodeURIComponent(profile.username)}`
      );
    }

    // Sambungkan akun Instagram ke admin yang sudah login
    const result = await InstagramService.verifyAndLinkAccount(targetUserId, {
      code,
      baseHandle: stateData.baseHandle,
    });

    const activeUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    const freshToken = activeUser
      ? generateToken({
          sub: activeUser.id,
          role: activeUser.role,
          handle: activeUser.handle,
          email: activeUser.email || undefined,
        })
      : '';

    const tokenQuery = freshToken ? `&token=${encodeURIComponent(freshToken)}` : '';

    if (origin === 'onboarding') {
      return res.redirect(
        `${ENV.FRONTEND_URL}/onboarding/base?ig_connected=true&ig_user=${encodeURIComponent(result.profile.username)}${tokenQuery}`
      );
    }
    if (origin === 'register') {
      return res.redirect(
        `${ENV.FRONTEND_URL}/onboarding/base?ig_connected=true&ig_user=${encodeURIComponent(result.profile.username)}${tokenQuery}`
      );
    }
    if (origin === 'login') {
      return res.redirect(
        `${ENV.FRONTEND_URL}/login?instagram=1&ig_connected=true&ig_user=${encodeURIComponent(result.profile.username)}${tokenQuery}`
      );
    }

    return res.redirect(
      `${ENV.FRONTEND_URL}/base-admin?panel=connections&ig_connected=true&ig_user=${encodeURIComponent(result.profile.username)}${tokenQuery}`
    );
  } catch (err: any) {
    console.error('[Instagram OAuth Callback Error]:', err.message);
    const returnErrorPath =
      origin === 'onboarding'
        ? '/onboarding/base'
        : origin === 'register'
        ? '/register/base'
        : origin === 'login'
        ? '/login'
        : '/base-admin?panel=connections';
    const sep = returnErrorPath.includes('?') ? '&' : '?';
    return res.redirect(
      `${ENV.FRONTEND_URL}${returnErrorPath}${sep}error=${encodeURIComponent(err.message || 'Gagal menghubungkan Instagram')}`
    );
  }
});

/**
 * Meta / Instagram Webhook Verification Challenge (GET)
 * Diperlukan saat setting Webhooks di dashboard Meta for Developers.
 */
router.get('/instagram/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === ENV.INSTAGRAM_VERIFY_TOKEN) {
    console.log('[Meta Webhook]: Verified successfully');
    return res.status(200).send(challenge);
  }

  console.warn('[Meta Webhook]: Verification failed, token mismatch');
  return res.sendStatus(403);
});

/**
 * Meta / Instagram Webhook Event Receiver (POST)
 */
router.post('/instagram/webhook', (req: Request, res: Response) => {
  console.log('[Meta Webhook Event Received]:', JSON.stringify(req.body));
  return res.status(200).send('EVENT_RECEIVED');
});

/**
 * Halaman info kecil untuk callback Meta — hanya agar URL-nya ramah saat
 * dibuka manual di browser (Meta sendiri selalu memanggil via POST).
 */
function metaCallbackInfoPage(
  title: string,
  description: string,
  linkHref = '',
  linkLabel = ''
): string {
  const link = linkHref
    ? `<p style="margin:18px 0 0"><a href="${linkHref}" style="color:#8ab4ff">${linkLabel}</a></p>`
    : '';
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Fess n Curious</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#101014;color:#e9e9ee;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
<main style="max-width:600px;padding:32px 24px;text-align:center">
<h1 style="font-size:20px;margin:0 0 12px">✅ ${title}</h1>
<p style="margin:0;line-height:1.7;color:#a9a9b4;font-size:15px">${description}</p>
${link}
</main>
</body>
</html>`;
}

/**
 * Info GET Deauthorize Callback — saat URL dibuka di browser tidak lagi
 * menampilkan "Cannot GET ..."; Meta tetap memakai POST di bawah.
 */
router.get('/instagram/deauthorize', (_req: Request, res: Response) => {
  return res
    .status(200)
    .type('html')
    .send(
      metaCallbackInfoPage(
        'Endpoint Deauthorize aktif',
        'Halaman ini bukan untuk dibuka manual. Meta memanggil endpoint ini otomatis (POST) saat pengguna mencabut akses aplikasi dari pengaturan Instagram. Kalau Anda melihat pesan ini, berarti endpoint sudah berfungsi dengan baik.'
      )
    );
});

/**
 * Deauthorize Callback Meta (Instagram Business Login).
 * Meta memanggil endpoint ini saat pengguna mencabut akses aplikasi dari
 * pengaturan Instagram — token & koneksi terkait otomatis diputus.
 * Wajib merespons JSON berisi URL status penghapusan data + confirmation_code.
 */
router.post('/instagram/deauthorize', async (req: Request, res: Response) => {
  const confirmationCode = crypto.randomBytes(12).toString('hex');
  const signedRequest = String(req.body?.signed_request || req.query.signed_request || '');

  try {
    const payload = parseSignedRequest(signedRequest, ENV.INSTAGRAM_CLIENT_SECRET);
    const igUserId = payload?.user_id ? String(payload.user_id) : null;
    if (igUserId) {
      await InstagramService.revokeInstagramAccess(igUserId, 'deauthorize');
    }
  } catch (err: any) {
    console.warn('[Instagram Deauthorize] Gagal memproses callback:', err?.message);
  }

  // Meta mengharapkan respons JSON berisi URL status penghapusan data.
  return res.json({
    url: `${ENV.FRONTEND_URL}/data-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
});

/**
 * Info GET Data Deletion Callback — ramah saat dibuka di browser; Meta tetap
 * memakai POST di bawah. Disertakan tautan ke halaman instruksi penghapusan.
 */
router.get('/instagram/data-deletion', (_req: Request, res: Response) => {
  return res
    .status(200)
    .type('html')
    .send(
      metaCallbackInfoPage(
        'Endpoint Data Deletion aktif',
        'Halaman ini bukan untuk dibuka manual. Meta memanggil endpoint ini otomatis (POST) saat pengguna meminta penghapusan data melalui Meta. Kalau Anda melihat pesan ini, berarti endpoint sudah berfungsi dengan baik.',
        `${ENV.FRONTEND_URL}/data-deletion`,
        'Buka halaman instruksi penghapusan data →'
      )
    );
});

/**
 * Data Deletion Callback Meta (setting "Data Deletion Request URL").
 * Menghapus token koneksi Instagram terkait + melepaskan binding login akun
 * IG tersebut, lalu merespons JSON status penghapusan sesuai spesifikasi Meta.
 */
router.post('/instagram/data-deletion', async (req: Request, res: Response) => {
  const confirmationCode = crypto.randomBytes(12).toString('hex');
  const signedRequest = String(req.body?.signed_request || req.query.signed_request || '');

  try {
    const payload = parseSignedRequest(signedRequest, ENV.INSTAGRAM_CLIENT_SECRET);
    const igUserId = payload?.user_id ? String(payload.user_id) : null;
    if (igUserId) {
      const result = await InstagramService.revokeInstagramAccess(igUserId, 'permintaan hapus data');
      console.log(
        `[Instagram DataDeletion] IG user ${igUserId}: ${result.connections} koneksi dicabut, ${result.users} binding user dilepas.`
      );
    }
  } catch (err: any) {
    console.warn('[Instagram DataDeletion] Gagal memproses callback:', err?.message);
  }

  return res.json({
    url: `${ENV.FRONTEND_URL}/data-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
});

export default router;
