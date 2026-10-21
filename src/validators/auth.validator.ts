import { z } from 'zod';
import { AvatarSchema } from './avatar.validator.js';

export const LoginSchema = z.object({
  identifier: z.string().min(1, 'Email atau username wajib diisi'),
  password: z.string().min(8, 'Password minimal 8 karakter'),
  role: z.enum(['User', 'Base Admin', 'Super Admin']).default('User'),
});

export const RegisterUserSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(8, 'Password minimal 8 karakter'),
  username: z.string().min(3, 'Username minimal 3 karakter').max(30, 'Username maksimal 30 karakter'),
  handle: z
    .string()
    .regex(/^@?[a-zA-Z0-9_.]{3,20}$/, 'Handle harus 3-20 karakter (huruf, angka, underscore, atau titik)'),
  avatar: AvatarSchema,
  bio: z.string().max(160, 'Bio maksimal 160 karakter').optional().nullable(),
});

export const RegisterBaseSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(8, 'Password minimal 8 karakter'),
  name: z.string().min(3, 'Nama Base minimal 3 karakter').max(50, 'Nama Base maksimal 50 karakter'),
  handle: z
    .string()
    .regex(/^@?[a-zA-Z0-9_.]{3,20}$/, 'Handle harus 3-20 karakter (huruf, angka, underscore, atau titik)'),
  avatar: AvatarSchema,
  bio: z.string().max(300, 'Bio maksimal 300 karakter').optional().nullable(),
  igAccount: z.string().optional().nullable(),
  category: z.enum(['Kampus', 'Kota', 'Hobi', 'Umum']).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Format warna harus hex 6 digit (#RRGGBB)')
    .optional(),
  keyword: z.string().optional().nullable(),
});

export const GoogleAuthSchema = z.object({
  id_token: z.string().min(1, 'Google ID token wajib diisi'),
  role: z.enum(['User', 'Base Admin']).default('User'),
});

// --- Reset kata sandi via OTP email (3 langkah terpisah) ---

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Format email tidak valid'),
});

export const VerifyResetOtpSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  otp: z
    .string()
    .regex(/^\d{6}$/, 'Kode OTP harus 6 digit angka'),
});

export const ResetPasswordSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  reset_token: z.string().min(32, 'Token reset tidak valid'),
  password: z.string().min(8, 'Kata sandi minimal 8 karakter'),
});

// --- Verifikasi email akun (OTP via Resend) ---

export const VerifyEmailSchema = z.object({
  ticket: z.string().min(20, 'Ticket verifikasi tidak valid'),
  otp: z.string().regex(/^\d{6}$/, 'Kode OTP harus 6 digit angka'),
});

export const ResendEmailVerificationSchema = z.object({
  ticket: z.string().min(20, 'Ticket verifikasi tidak valid'),
});

export const ChangeVerificationEmailSchema = z.object({
  ticket: z.string().min(20, 'Ticket verifikasi tidak valid'),
  new_email: z.string().email('Format email baru tidak valid'),
});

export const InstagramVerifySchema = z.object({
  token: z.string().optional(),
  code: z.string().optional(),
  handle: z.string().optional(),
});
