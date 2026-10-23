import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../..');

// Load environment variables explicitly from backend/.env and process.cwd().
// Production/Vercel keeps using process env + .env; local development can
// override it with backend/.env.development so production credentials are
// never used by accident.
dotenv.config({ path: path.join(backendRoot, '.env') });
dotenv.config();

if ((process.env.NODE_ENV || 'development') === 'development') {
  const devEnvPath = path.join(backendRoot, '.env.development');
  if (fs.existsSync(devEnvPath)) {
    dotenv.config({ path: devEnvPath, override: true });
  } else if (process.env.ALLOW_PROD_DB_FOR_LOCAL === 'true') {
    console.warn(
      '[env] backend/.env.development not found; ALLOW_PROD_DB_FOR_LOCAL=true so ' +
        'falling back to backend/.env. Do not use production data for normal development.'
    );
  } else {
    throw new Error(
      'backend/.env.development is required for local development. ' +
        'Copy .env.development.example and fill in the dev Supabase credentials. ' +
        'If you really need to use backend/.env, set ALLOW_PROD_DB_FOR_LOCAL=true.'
    );
  }
}

const nodeEnv = process.env.NODE_ENV || 'development';
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const defaultAllowedOrigins =
  nodeEnv === 'production' ? frontendUrl : `${frontendUrl},http://localhost:5173`;

export const ENV = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: nodeEnv,
  API_PREFIX: process.env.API_PREFIX || '/api',
  FRONTEND_URL: frontendUrl,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || defaultAllowedOrigins,

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'fess_secret_jwt_key_2026',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1d',

  // Supabase
  DATABASE_URL: process.env.DATABASE_URL || '',
  DIRECT_URL: process.env.DIRECT_URL || '',
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://dummy.supabase.co',
  SUPABASE_KEY: process.env.SUPABASE_KEY || 'dummy-supabase-key',
  SUPABASE_BUCKET: process.env.SUPABASE_BUCKET || 'confess-media',

  // Google OAuth
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback',

  // Meta Instagram Graph API
  INSTAGRAM_CLIENT_ID: process.env.INSTAGRAM_CLIENT_ID || '',
  INSTAGRAM_CLIENT_SECRET: process.env.INSTAGRAM_CLIENT_SECRET || '',
  INSTAGRAM_CALLBACK_URL: process.env.INSTAGRAM_CALLBACK_URL || 'http://localhost:3000/api/auth/instagram/callback',
  INSTAGRAM_REDIRECT_URI: process.env.INSTAGRAM_REDIRECT_URI || 'http://localhost:3000/api/auth/instagram/callback',
  INSTAGRAM_VERIFY_TOKEN: process.env.INSTAGRAM_VERIFY_TOKEN || 'fess_instagram_verify_token_2026',
  // Versi Graph API Instagram (naikkan sesuai rilis Meta terbaru).
  INSTAGRAM_API_VERSION: process.env.INSTAGRAM_API_VERSION || 'v25.0',
  // Scope OAuth — hanya permission yang benar-benar dipakai app (syarat App Review).
  // `instagram_business_manage_insights` wajib untuk endpoint /insights.
  INSTAGRAM_SCOPES:
    process.env.INSTAGRAM_SCOPES ||
    'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights',

  // URL publik backend (dipakai worker internal untuk memanggil dirinya sendiri)
  BACKEND_PUBLIC_URL:
    process.env.BACKEND_PUBLIC_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : `http://localhost:${parseInt(process.env.PORT || '3000', 10)}`),

  // Email (Resend SDK) — dipakai untuk mengirim kode OTP reset kata sandi
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'Fess n Curious <onboarding@resend.dev>',
};
