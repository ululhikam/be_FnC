import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailService } from '../src/services/email.service.js';
import { ENV } from '../src/config/env.js';

// Mock Resend SDK
const mockSend = vi.fn();
vi.mock('resend', () => {
  return {
    Resend: class MockResend {
      emails = {
        send: mockSend,
      };
    },
  };
});

describe('EmailService Unit Tests (Resend SDK)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (EmailService as any).resendClient = null;
  });

  it('should detect when Resend is not configured', () => {
    ENV.RESEND_API_KEY = '';
    expect(EmailService.isConfigured()).toBe(false);
  });

  it('should detect when Resend is configured', () => {
    ENV.RESEND_API_KEY = 're_test_key_123';
    expect(EmailService.isConfigured()).toBe(true);
  });

  it('should throw 503 error if sendMail is called when not configured', async () => {
    ENV.RESEND_API_KEY = '';

    await expect(
      EmailService.sendMail({
        to: 'user@example.com',
        subject: 'Test',
        text: 'Hello',
      })
    ).rejects.toThrow('Layanan email belum dikonfigurasi di server (Resend API key belum diisi).');
  });

  it('should successfully send email using Resend SDK when RESEND_API_KEY is provided', async () => {
    ENV.RESEND_API_KEY = 're_test_key_123';
    ENV.EMAIL_FROM = 'Fess n Curious <onboarding@resend.dev>';
    mockSend.mockResolvedValueOnce({ data: { id: 'email_123' }, error: null });

    const result = await EmailService.sendMail({
      to: 'target@example.com',
      subject: 'Reset Password',
      text: 'OTP: 123456',
      html: '<b>123456</b>',
    });

    expect(result).toEqual({ id: 'email_123' });
    expect(mockSend).toHaveBeenCalledWith({
      from: 'Fess n Curious <onboarding@resend.dev>',
      to: 'target@example.com',
      subject: 'Reset Password',
      text: 'OTP: 123456',
      html: '<b>123456</b>',
    });
  });

  it('should throw an error if Resend API returns an error', async () => {
    ENV.RESEND_API_KEY = 're_test_key_123';
    mockSend.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid API key or domain not verified' },
    });

    await expect(
      EmailService.sendMail({
        to: 'target@example.com',
        subject: 'Reset Password',
        text: 'OTP: 123456',
      })
    ).rejects.toThrow('Gagal mengirim email via Resend: Invalid API key or domain not verified');
  });

  it('should format and send OTP via sendPasswordResetOtp', async () => {
    ENV.RESEND_API_KEY = 're_test_key_123';
    ENV.EMAIL_FROM = 'Fess n Curious <onboarding@resend.dev>';
    mockSend.mockResolvedValueOnce({ data: { id: 'email_otp_123' }, error: null });

    await EmailService.sendPasswordResetOtp('target@example.com', '654321');

    expect(mockSend).toHaveBeenCalledTimes(1);
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.to).toBe('target@example.com');
    expect(callArgs.subject).toContain('Kode OTP');
    expect(callArgs.text).toContain('654321');
    expect(callArgs.html).toContain('654321');
  });
});
