/**
 * EmailService — pengiriman email transaksional via Resend SDK.
 * ---------------------------------------------------------------------------
 * Dipakai untuk kode OTP verifikasi email akun dan reset kata sandi.
 * Konfigurasi lewat env:
 *   RESEND_API_KEY, EMAIL_FROM
 */

import { Resend } from 'resend';
import { ENV } from '../config/env.js';

export class EmailService {
  private static resendClient: Resend | null = null;

  /** True jika Resend API key sudah diisi. */
  static isConfigured(): boolean {
    return Boolean(ENV.RESEND_API_KEY);
  }

  private static getResend(): Resend {
    if (!this.resendClient) {
      this.resendClient = new Resend(ENV.RESEND_API_KEY);
    }
    return this.resendClient;
  }

  /** Kirim email transaksional via Resend — melempar error bila belum dikonfigurasi. */
  static async sendMail(options: { to: string; subject: string; text: string; html?: string }) {
    if (!this.isConfigured()) {
      const err: any = new Error('Layanan email belum dikonfigurasi di server (Resend API key belum diisi).');
      err.status = 503;
      err.code = 'EMAIL_NOT_CONFIGURED';
      throw err;
    }

    const { data, error } = await this.getResend().emails.send({
      from: ENV.EMAIL_FROM,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });

    if (error) {
      const err: any = new Error(`Gagal mengirim email via Resend: ${error.message}`);
      err.status = 502;
      err.code = 'RESEND_API_ERROR';
      err.details = error;
      throw err;
    }

    return data;
  }

  /** Email kode OTP verifikasi alamat email akun (berlaku 10 menit). */
  static async sendEmailVerificationOtp(to: string, otp: string) {
    const subject = 'Verifikasi Email — Fess n Curious';
    const text = [
      `Kode verifikasi email kamu: ${otp}`,
      '',
      'Kode ini berlaku 10 menit dan hanya bisa dipakai sekali.',
      'Jika kamu tidak merasa mendaftar di Fess n Curious, abaikan email ini.',
    ].join('\n');

    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
        <h2 style="margin: 0 0 12px;">Verifikasi Email</h2>
        <p style="margin: 0 0 16px; line-height: 1.5;">
          Gunakan kode OTP berikut untuk memverifikasi alamat email akun
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
          Jika kamu tidak merasa mendaftar, abaikan email ini.
        </p>
      </div>
    `;

    await this.sendMail({ to, subject, text, html });
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
