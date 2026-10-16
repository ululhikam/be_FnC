import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../..');

// Load environment variables explicitly from backend/.env and process.cwd()
dotenv.config({ path: path.join(backendRoot, '.env') });
dotenv.config();

export const ENV = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  API_PREFIX: process.env.API_PREFIX || '/api',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'fess_secret_jwt_key_2026',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

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

  // Email (Resend SDK) — dipakai untuk mengirim kode OTP reset kata sandi
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'Fess n Curious <onboarding@resend.dev>',
};
