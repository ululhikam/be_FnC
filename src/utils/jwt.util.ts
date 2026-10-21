import jwt from 'jsonwebtoken';
import { ENV } from '../config/env.js';

export interface JwtPayload {
  sub: string;
  role: string;
  handle?: string;
  email?: string;
  [key: string]: any;
}

export function generateToken(payload: JwtPayload, expiresIn = ENV.JWT_EXPIRES_IN): string {
  return jwt.sign(payload, ENV.JWT_SECRET, {
    expiresIn: expiresIn as any,
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, ENV.JWT_SECRET) as JwtPayload;
}

/**
 * Ticket verifikasi email sengaja memakai secret turunan yang berbeda.
 * Dengan begitu ticket tidak pernah bisa dipakai sebagai Bearer token akses,
 * dan JWT akses tidak bisa dipakai sebagai ticket verifikasi.
 */
const EMAIL_VERIFICATION_SECRET = `${ENV.JWT_SECRET}:email-verification`;

export interface EmailVerificationTicketPayload extends JwtPayload {
  purpose: 'email_verification';
  email: string;
}

export function generateEmailVerificationTicket(
  payload: { sub: string; role?: string; email: string },
  expiresIn = '30m'
): string {
  return jwt.sign(
    { ...payload, purpose: 'email_verification' },
    EMAIL_VERIFICATION_SECRET,
    { expiresIn: expiresIn as any }
  );
}

export function verifyEmailVerificationTicket(token: string): EmailVerificationTicketPayload {
  const payload = jwt.verify(token, EMAIL_VERIFICATION_SECRET) as EmailVerificationTicketPayload;
  if (payload.purpose !== 'email_verification' || !payload.sub || !payload.email) {
    throw new Error('Ticket verifikasi email tidak valid');
  }
  return payload;
}
