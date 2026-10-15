/**
 * EmailService — pengiriman email transaksional via SMTP (nodemailer).
 * ---------------------------------------------------------------------------
 * Dipakai untuk kode OTP reset kata sandi. Konfigurasi lewat env:
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Jika SMTP belum dikonfigurasi, `isConfigured()` bernilai false dan
 * pemanggil (AuthService) yang memutuskan fallback-nya — di development
 * kode OTP ditulis ke konsol, di production request ditolak.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { ENV } from '../config/env.js';

export class EmailService {
  private static transporter: Transporter | null = null;

  /** True jika kredensial SMTP inti sudah diisi. */
  static isConfigured(): boolean {
    return Boolean(ENV.SMTP_HOST && ENV.SMTP_USER && ENV.SMTP_PASS);
  }

  private static getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: ENV.SMTP_HOST,
        port: ENV.SMTP_PORT,
        secure: ENV.SMTP_SECURE,
        auth: {
          user: ENV.SMTP_USER,
          pass: ENV.SMTP_PASS,
        },
      });
    }
    return this.transporter;
  }

  /** Kirim email umum — melempar error 503 bila SMTP belum dikonfigurasi. */
  static async sendMail(options: { to: string; subject: string; text: string; html?: string }) {
    if (!this.isConfigured()) {
      const err: any = new Error('Layanan email belum dikonfigurasi di server (SMTP).');
      err.status = 503;
      err.code = 'EMAIL_NOT_CONFIGURED';
      throw err;
    }

    await this.getTransporter().sendMail({
      from: ENV.SMTP_FROM,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
  }

  /** Email kode OTP reset kata sandi (berlaku 10 menit). */
  static async sendPasswordResetOtp(to: string, otp: string) {
    const subject = 'Kode OTP Reset Kata Sandi — Fess n Curious';
    const text = [
      `Kode OTP reset kata sandi kamu: ${otp}`,
      '',
      'Kode ini berlaku 10 menit dan hanya bisa dipakai sekali.',
      'Jika kamu tidak meminta reset kata sandi, abaikan email ini — kata sandimu tidak berubah.',
    ].join('\n');

    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
        <h2 style="margin: 0 0 12px;">Reset Kata Sandi</h2>
        <p style="margin: 0 0 16px; line-height: 1.5;">
          Gunakan kode OTP berikut untuk melanjutkan proses reset kata sandi akun
          <strong>Fess n Curious</strong> kamu:
        </p>
        <div style="font-size: 32px; font-weight: 800; letter-spacing: 8px; text-align: center;
                    background: #f4f6ff; border: 1px solid #dfe4ff; border-radius: 12px;
                    padding: 16px; margin: 0 0 16px;">
          ${otp}
        </div>
        <p style="margin: 0 0 8px; font-size: 13px; color: #444;">
          Kode ini berlaku <strong>10 menit</strong> dan hanya bisa dipakai sekali.
        </p>
        <p style="margin: 0; font-size: 13px; color: #444;">
          Jika kamu tidak meminta reset kata sandi, abaikan email ini — kata sandimu tidak berubah.
        </p>
      </div>
    `;

    await this.sendMail({ to, subject, text, html });
  }
}
