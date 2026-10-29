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
  VerifyEmailSchema,
  ResendEmailVerificationSchema,
  ChangeVerificationEmailSchema,
} from '../validators/auth.validator.js';
import { generateToken, verifyToken } from '../utils/jwt.util.js';
import { ENV } from '../config/env.js';
import { InstagramService } from '../services/instagram.service.js';
import { AuthService } from '../services/auth.service.js';
import { prisma } from '../config/prisma.js';
import { parseSignedRequest } from '../utils/meta-signed-request.util.js';
import { signOAuthState, verifyOAuthState } from '../utils/oauth-state.util.js';
import { authRateLimit, bodyIdentity } from '../middlewares/authRateLimit.middleware.js';

const router = Router();

/**
 * Ticket verifikasi tidak boleh ikut terkirim ke server/referrer lewat query.
 * Taruh di fragment URL; frontend membacanya lalu langsung membersihkan hash.
 */
function emailVerificationRedirectUrl(
  email: string,
  challenge: { verification_ticket: string; email_sent: boolean }
) {
  const query = new URLSearchParams({ email });
  if (!challenge.email_sent) query.set('sent', '0');
  const fragment = new URLSearchParams({ ticket: challenge.verification_ticket });
  return `${ENV.FRONTEND_URL}/verify-email?${query.toString()}#${fragment.toString()}`;
}

// Standard API Contract Endpoints
// Kuota percobaan disimpan di Postgres (bukan memori instance) supaya lockout
// tetap berlaku walau request tersebar ke banyak invocation serverless.
// Batas IP sengaja lebih longgar daripada batas identitas: banyak pengguna sah
// bisa berada di balik satu IP (kantor/kos), sedangkan brute force menyasar
// satu akun sehingga tertahan oleh batas identitas.
router.post(
  '/login',
  authRateLimit({
    name: 'login',
    ipLimit: 60,
    identityLimit: 10,
    windowSeconds: 15 * 60,
    identify: bodyIdentity,
    message: 'Terlalu banyak percobaan masuk. Tunggu 15 menit sebelum mencoba lagi.',
    code: 'LOGIN_RATE_LIMITED',
  }),
  validateBody(LoginSchema),
  AuthController.login
);
router.post('/login/google', validateBody(GoogleAuthSchema), AuthController.loginGoogle);
router.post(
  '/register/user',
  authRateLimit({ name: 'register', ipLimit: 10, windowSeconds: 60 * 60 }),
  validateBody(RegisterUserSchema),
  AuthController.registerUser
);
router.post(
  '/register/base',
  authRateLimit({ name: 'register', ipLimit: 10, windowSeconds: 60 * 60 }),
  validateBody(RegisterBaseSchema),
  AuthController.registerBase
);
router.post('/logout', requireAuth, AuthController.logout);
router.get('/me', requireAuth, AuthController.getMe);
router.post('/refresh', requireAuth, AuthController.refreshToken);

// Reset kata sandi via kode OTP email (3 langkah, tanpa sesi login)
router.post(
  '/forgot-password',
  authRateLimit({
    name: 'forgot-password',
    ipLimit: 10,
    identityLimit: 3,
    windowSeconds: 15 * 60,
    identify: bodyIdentity,
    message: 'Terlalu banyak permintaan kode OTP. Tunggu 15 menit sebelum mencoba lagi.',
    code: 'OTP_RATE_LIMITED',
  }),
  validateBody(ForgotPasswordSchema),
  AuthController.forgotPassword
);
router.post(
  '/verify-reset-otp',
  authRateLimit({
    name: 'verify-reset-otp',
    ipLimit: 20,
    identityLimit: 10,
    windowSeconds: 15 * 60,
    identify: bodyIdentity,
    message: 'Terlalu banyak percobaan kode OTP. Tunggu 15 menit sebelum mencoba lagi.',
    code: 'OTP_RATE_LIMITED',
  }),
  validateBody(VerifyResetOtpSchema),
  AuthController.verifyResetOtp
);
router.post('/reset-password', validateBody(ResetPasswordSchema), AuthController.resetPassword);

// Verifikasi email akun (OTP via Resend) — tanpa sesi login.
router.post(
  '/email-verification/verify',
  authRateLimit({
    name: 'verify-email',
    ipLimit: 20,
    identityLimit: 10,
    windowSeconds: 15 * 60,
    identify: bodyIdentity,
    message: 'Terlalu banyak percobaan kode verifikasi. Tunggu 15 menit sebelum mencoba lagi.',
    code: 'OTP_RATE_LIMITED',
  }),
  validateBody(VerifyEmailSchema),
  AuthController.verifyEmail
);
router.post(
  '/email-verification/resend',
  authRateLimit({
    name: 'resend-verification',
    ipLimit: 10,
    identityLimit: 3,
    windowSeconds: 15 * 60,
    identify: bodyIdentity,
    message: 'Terlalu banyak permintaan kirim ulang. Tunggu 15 menit sebelum mencoba lagi.',
    code: 'OTP_RATE_LIMITED',
  }),
  validateBody(ResendEmailVerificationSchema),
  AuthController.resendEmailVerification
);
router.post('/email-verification/change-email', validateBody(ChangeVerificationEmailSchema), AuthController.changeVerificationEmail);

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
  async (req: Request, res: Response) => {
    const user = req.user as any;

    // Akun lama yang belum pernah verifikasi email wajib menyelesaikan OTP,
    // termasuk ketika masuk lewat Google. Akun Google baru sudah auto-verified
    // saat dibuat di passport strategy.
    if (user.email && !user.emailVerifiedAt) {
      try {
        const challenge = await AuthService.createEmailVerificationChallenge(user);
        return res.redirect(emailVerificationRedirectUrl(user.email, challenge));
      } catch {
        return res.redirect(`${ENV.FRONTEND_URL}/login?error=email_verification_failed`);
      }
    }

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
const INSTAGRAM_ORIGINS = new Set(['connections', 'onboarding', 'register', 'login']);

function instagramReturnPath(origin: string): string {
  if (origin === 'onboarding') return '/onboarding/base';
  if (origin === 'register') return '/register/base';
  if (origin === 'login') return '/login';
  return '/base-admin?panel=connections';
}

router.get('/instagram', (req, res) => {
  const rawOrigin = String(req.query.origin || 'connections');
  const origin = INSTAGRAM_ORIGINS.has(rawOrigin) ? rawOrigin : 'connections';
  const returnErrorPath = instagramReturnPath(origin);

  if (!ENV.INSTAGRAM_CLIENT_ID || !ENV.INSTAGRAM_CLIENT_SECRET) {
    const sep = returnErrorPath.includes('?') ? '&' : '?';
    return res.redirect(`${ENV.FRONTEND_URL}${returnErrorPath}${sep}error=instagram_not_configured`);
  }

  // Token JWT admin yang sedang login bisa dioper via query parameter.
  // Hanya dipakai sebagai penanda "hubungkan akun"; callback tetap memverifikasi
  // tanda tangan state sebelum mempercayai userId.
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

  const statePayload = signOAuthState({
    userId,
    baseHandle: String(req.query.base || ''),
    origin,
  });

  const authUrl = InstagramService.getAuthorizationUrl(statePayload);
  res.redirect(authUrl);
});

router.get('/instagram/callback', async (req: Request, res: Response) => {
  let origin = 'connections';
  try {
    const code = req.query.code as string;
    const error = req.query.error as string;
    const errorDesc = req.query.error_description as string;

    // State wajib bertanda tangan: isinya menentukan akun mana yang akan
    // ditautkan / diberi sesi. Tanpa verifikasi ini siapa pun bisa membuat
    // state yang menunjuk user lain (takeover akun).
    const stateData = verifyOAuthState(String(req.query.state || ''));
    if (!stateData) {
      return res.redirect(`${ENV.FRONTEND_URL}/login?error=oauth_state_invalid`);
    }

    origin = INSTAGRAM_ORIGINS.has(stateData.origin) ? stateData.origin : 'connections';
    const returnErrorPath = instagramReturnPath(origin);

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

      // JANGAN menautkan akun berdasarkan kecocokan `handle`/username Instagram.
      // Sebelumnya akun FnC dicari dengan `handle = @username_ig` lalu diberi
      // `instagramId` — siapa pun bisa membuat akun Instagram bernama sama
      // dengan handle korban dan langsung mendapat sesi korban. Penautan hanya
      // sah lewat `instagramId` (login IG yang sudah pernah tersimpan) atau
      // lewat alur "hubungkan akun" saat sudah login.

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

      // Akun lama dengan email belum terverifikasi tidak boleh mendapat sesi
      // penuh hanya karena masuk lewat Instagram. Akun IG-only (tanpa email)
      // tetap dikecualikan.
      if (user.email && !user.emailVerifiedAt) {
        try {
          const challenge = await AuthService.createEmailVerificationChallenge(user);
          return res.redirect(emailVerificationRedirectUrl(user.email, challenge));
        } catch {
          return res.redirect(`${ENV.FRONTEND_URL}/login?error=email_verification_failed`);
        }
      }

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

    if (activeUser?.email && !activeUser.emailVerifiedAt) {
      try {
        const challenge = await AuthService.createEmailVerificationChallenge(activeUser);
        return res.redirect(emailVerificationRedirectUrl(activeUser.email, challenge));
      } catch {
        return res.redirect(`${ENV.FRONTEND_URL}/login?error=email_verification_failed`);
      }
    }

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
    const returnErrorPath = instagramReturnPath(origin);
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
  // Body webhook memuat id akun, media, dan komentar pengguna (PII). Cukup catat
  // ringkasannya saja — log Vercel bisa dibaca banyak orang dan disimpan lama.
  const body = (req.body || {}) as {
    object?: unknown;
    entry?: Array<{ id?: unknown; time?: unknown; changes?: Array<{ field?: unknown }> }>;
  };
  const entries = Array.isArray(body.entry) ? body.entry : [];
  console.log(
    '[Meta Webhook Event Received]',
    JSON.stringify({
      object: typeof body.object === 'string' ? body.object : undefined,
      entries: entries.length,
      entryIds: entries.slice(0, 5).map((entry) => String(entry?.id ?? '')),
      fields: entries
        .flatMap((entry) => (Array.isArray(entry?.changes) ? entry.changes : []))
        .slice(0, 10)
        .map((change) => String(change?.field ?? '')),
    })
  );
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
