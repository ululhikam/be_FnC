import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { AuthService } from '../src/services/auth.service.js';
import { EmailService } from '../src/services/email.service.js';
import { prisma } from '../src/config/prisma.js';
import * as passwordUtil from '../src/utils/password.util.js';
import { generateEmailVerificationTicket } from '../src/utils/jwt.util.js';

const testSha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    base: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    passwordReset: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    emailVerification: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('AuthService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('should throw error when user is not found', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);

      await expect(AuthService.login('notfound@mail.com', 'password123', 'User')).rejects.toThrow(
        'Email atau username tidak ditemukan'
      );
    });

    it('should throw error if user is banned', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: 'usr_banned',
        email: 'banned@mail.com',
        isBanned: true,
        banReason: 'Spamming',
      } as any);

      await expect(AuthService.login('banned@mail.com', 'password123', 'User')).rejects.toThrow(
        'Akun telah dibekukan'
      );
    });

    it('should throw error on incorrect password', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: 'usr_1',
        email: 'user@mail.com',
        password: 'hashed_password',
        isBanned: false,
        role: 'User',
      } as any);

      vi.spyOn(passwordUtil, 'comparePassword').mockResolvedValueOnce(false);

      await expect(AuthService.login('user@mail.com', 'wrongpassword', 'User')).rejects.toThrow(
        'Password yang dimasukkan salah'
      );
    });

    it('should return user and token on successful login', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: 'usr_1',
        username: 'Alex Pratama',
        handle: '@alex_reader',
        email: 'alex@mail.com',
        password: 'hashed_password',
        isBanned: false,
        role: 'User',
        level: 14,
        badges: ['MEMBER'],
        managedBases: [],
        emailVerifiedAt: new Date(),
        createdAt: new Date(),
      } as any);

      vi.spyOn(passwordUtil, 'comparePassword').mockResolvedValueOnce(true);

      const result = await AuthService.login('alex@mail.com', 'password123', 'User');
      expect(result.user).toBeDefined();
      expect(result.user.handle).toBe('@alex_reader');
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
    });

    it('should prevent regular user from accessing Base Admin role', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: 'usr_1',
        email: 'user@mail.com',
        password: 'hashed_password',
        isBanned: false,
        role: 'User',
      } as any);

      vi.spyOn(passwordUtil, 'comparePassword').mockResolvedValueOnce(true);

      await expect(AuthService.login('user@mail.com', 'password123', 'Base Admin')).rejects.toThrow(
        'User tidak memiliki akses sebagai Base Admin'
      );
    });
  });

  describe('registerUser', () => {
    it('should throw error if email or handle already exists', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: 'existing_usr' } as any);

      await expect(
        AuthService.registerUser({
          email: 'dup@mail.com',
          password: 'password123',
          username: 'Duplicate',
          handle: '@duplicate',
        })
      ).rejects.toThrow();
    });

    it('should successfully register new user and start email verification', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.emailVerification.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.emailVerification.upsert).mockResolvedValueOnce({} as any);
      vi.spyOn(EmailService, 'sendEmailVerificationOtp').mockResolvedValueOnce(undefined);
      vi.mocked(prisma.user.create).mockResolvedValueOnce({
        id: 'usr_new',
        username: 'New User',
        handle: '@newuser',
        email: 'new@mail.com',
        role: 'User',
        badges: ['NEW MEMBER'],
        managedBases: [],
        createdAt: new Date(),
      } as any);

      const result = await AuthService.registerUser({
        email: 'new@mail.com',
        password: 'password123',
        username: 'New User',
        handle: '@newuser',
      });

      expect(result.user.id).toBe('usr_new');
      expect(result.requires_email_verification).toBe(true);
      expect(result.token).toBeUndefined();
      expect(typeof result.verification_ticket).toBe('string');
    });

    it('should block password login until the email is verified', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: 'usr_unverified',
        username: 'Unverified',
        handle: '@unverified',
        email: 'unverified@mail.com',
        password: 'hashed_password',
        isBanned: false,
        role: 'User',
        level: 1,
        badges: ['MEMBER'],
        managedBases: [],
        emailVerifiedAt: null,
        createdAt: new Date(),
      } as any);
      vi.mocked(prisma.emailVerification.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.emailVerification.upsert).mockResolvedValueOnce({} as any);
      vi.spyOn(EmailService, 'sendEmailVerificationOtp').mockResolvedValueOnce(undefined);
      vi.spyOn(passwordUtil, 'comparePassword').mockResolvedValueOnce(true);

      const result = await AuthService.login('unverified@mail.com', 'password123', 'User');

      expect(result.requires_email_verification).toBe(true);
      expect(result.token).toBeUndefined();
      expect(result.user).toBeUndefined();
      expect(typeof result.verification_ticket).toBe('string');
    });
  });

  describe('email verification', () => {
    it('verifies the correct OTP and issues a session token', async () => {
      const user = {
        id: 'usr_verify',
        username: 'Verify Me',
        handle: '@verifyme',
        email: 'verify@mail.com',
        password: 'hashed_password',
        role: 'User',
        badges: ['MEMBER'],
        managedBases: [],
        emailVerifiedAt: null,
        createdAt: new Date(),
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(user as any);
      vi.mocked(prisma.emailVerification.findUnique).mockResolvedValueOnce({
        userId: user.id,
        otpHash: testSha256('123456'),
        otpExpiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
      } as any);
      vi.mocked(prisma.$transaction).mockResolvedValueOnce([{}, {}] as any);

      const ticket = generateEmailVerificationTicket({
        sub: user.id,
        role: user.role,
        email: user.email,
      });

      const result = await AuthService.verifyEmail(ticket, '123456');

      expect(result.token).toBeDefined();
      expect(result.user.email_verified).toBe(true);
      expect(prisma.emailVerification.deleteMany).toHaveBeenCalled();
    });

    it('increments attempts and rejects a wrong OTP', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'usr_verify',
        username: 'Verify Me',
        handle: '@verifyme',
        email: 'verify@mail.com',
        role: 'User',
        badges: ['MEMBER'],
        managedBases: [],
        emailVerifiedAt: null,
        createdAt: new Date(),
      } as any);
      vi.mocked(prisma.emailVerification.findUnique).mockResolvedValueOnce({
        userId: 'usr_verify',
        otpHash: testSha256('123456'),
        otpExpiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
      } as any);
      vi.mocked(prisma.emailVerification.update).mockResolvedValueOnce({} as any);

      const ticket = generateEmailVerificationTicket({
        sub: 'usr_verify',
        role: 'User',
        email: 'verify@mail.com',
      });

      await expect(AuthService.verifyEmail(ticket, '000000')).rejects.toThrow('Kode OTP salah');
      expect(prisma.emailVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { attempts: { increment: 1 } } })
      );
    });
  });

  describe('getMe', () => {
    it('should return serialized user data', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'usr_me',
        username: 'Me',
        handle: '@me',
        email: 'me@mail.com',
        role: 'User',
        badges: ['ANON SENDER'],
        managedBases: [],
        createdAt: new Date(),
      } as any);

      const user = await AuthService.getMe('usr_me');
      expect(user.id).toBe('usr_me');
      expect(user.handle).toBe('@me');
    });

    it('should throw 404 if user does not exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      await expect(AuthService.getMe('nonexistent')).rejects.toThrow('Pengguna tidak ditemukan');
    });
  });

  describe('forgotPassword / verifyResetOtp / resetPassword (OTP email)', () => {
    const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

    it('should return a generic message for unknown email (anti-enumeration)', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);

      const res: any = await AuthService.forgotPassword('ghost@mail.com');
      expect(res.message).toContain('Jika email tersebut terdaftar');
      expect(res.dev_otp).toBeUndefined();
      expect(prisma.passwordReset.upsert).not.toHaveBeenCalled();
    });

    it('should store a hashed OTP and send email without leaking OTP in response', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: 'usr_1',
        email: 'alex@mail.com',
      } as any);
      vi.mocked(prisma.passwordReset.upsert).mockResolvedValueOnce({} as any);
      const emailSpy = vi.spyOn(EmailService, 'sendPasswordResetOtp').mockResolvedValueOnce(undefined as any);

      const res: any = await AuthService.forgotPassword('alex@mail.com');
      expect(res.message).toContain('Jika email tersebut terdaftar');
      expect(res.dev_otp).toBeUndefined();

      const upsertCall: any = vi.mocked(prisma.passwordReset.upsert).mock.calls[0][0];
      expect(upsertCall.where).toEqual({ userId: 'usr_1' });
      expect(upsertCall.create.otpHash).toBeDefined();
      expect(upsertCall.update.otpHash).toBeDefined();

      expect(emailSpy).toHaveBeenCalledWith('alex@mail.com', expect.stringMatching(/^\d{6}$/));
      emailSpy.mockRestore();
    });

    it('should increment attempts and reject a wrong OTP', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: 'usr_1' } as any);
      vi.mocked(prisma.passwordReset.findUnique).mockResolvedValueOnce({
        userId: 'usr_1',
        otpHash: sha256('123456'),
        otpExpiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
      } as any);

      await expect(AuthService.verifyResetOtp('alex@mail.com', '000000')).rejects.toThrow(
        'Kode OTP salah'
      );

      const updateCall: any = vi.mocked(prisma.passwordReset.update).mock.calls[0][0];
      expect(updateCall.data.attempts).toEqual({ increment: 1 });
    });

    it('should reject an expired OTP', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: 'usr_1' } as any);
      vi.mocked(prisma.passwordReset.findUnique).mockResolvedValueOnce({
        userId: 'usr_1',
        otpHash: sha256('123456'),
        otpExpiresAt: new Date(Date.now() - 1000),
        attempts: 0,
      } as any);

      await expect(AuthService.verifyResetOtp('alex@mail.com', '123456')).rejects.toThrow(
        'kedaluwarsa'
      );
    });

    it('should reject when max attempts are exhausted', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: 'usr_1' } as any);
      vi.mocked(prisma.passwordReset.findUnique).mockResolvedValueOnce({
        userId: 'usr_1',
        otpHash: sha256('123456'),
        otpExpiresAt: new Date(Date.now() + 60_000),
        attempts: 5,
      } as any);

      await expect(AuthService.verifyResetOtp('alex@mail.com', '123456')).rejects.toThrow(
        'Terlalu banyak percobaan'
      );
    });

    it('should issue a single-use reset token for the correct OTP', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: 'usr_1' } as any);
      vi.mocked(prisma.passwordReset.findUnique).mockResolvedValueOnce({
        userId: 'usr_1',
        otpHash: sha256('424242'),
        otpExpiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
      } as any);
      vi.mocked(prisma.passwordReset.update).mockResolvedValueOnce({} as any);

      const res = await AuthService.verifyResetOtp('alex@mail.com', '424242');
      expect(res.reset_token).toMatch(/^[0-9a-f]{64}$/);

      const updateCall: any = vi.mocked(prisma.passwordReset.update).mock.calls[0][0];
      expect(updateCall.data.resetTokenHash).toBe(sha256(res.reset_token));
    });

    it('should reject an invalid reset token', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: 'usr_1' } as any);
      vi.mocked(prisma.passwordReset.findUnique).mockResolvedValueOnce({
        userId: 'usr_1',
        resetTokenHash: sha256('valid-token'),
        resetTokenExpiresAt: new Date(Date.now() + 60_000),
      } as any);

      await expect(
        AuthService.resetPassword('alex@mail.com', 'wrong-token', 'newpassword123')
      ).rejects.toThrow('Sesi reset tidak valid');
    });

    it('should update the password hash and consume the token on success', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: 'usr_1' } as any);
      vi.mocked(prisma.passwordReset.findUnique).mockResolvedValueOnce({
        userId: 'usr_1',
        resetTokenHash: sha256('valid-token'),
        resetTokenExpiresAt: new Date(Date.now() + 60_000),
      } as any);
      vi.spyOn(passwordUtil, 'hashPassword').mockResolvedValueOnce('hashed_new_pw' as any);
      vi.mocked(prisma.$transaction).mockResolvedValueOnce([] as any);

      const res = await AuthService.resetPassword('alex@mail.com', 'valid-token', 'newpassword123');
      expect(res.ok).toBe(true);

      const userUpdateCall: any = vi.mocked(prisma.user.update).mock.calls[0][0];
      expect(userUpdateCall.data.password).toBe('hashed_new_pw');
      expect(prisma.passwordReset.delete).toHaveBeenCalledWith({ where: { userId: 'usr_1' } });
    });
  });

  describe('login security for passwordless accounts', () => {
    it('should reject password login for Google-only account', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: 'usr_g',
        email: 'g@mail.com',
        password: null,
        googleId: 'google_123',
        isBanned: false,
        role: 'User',
      } as any);

      await expect(AuthService.login('g@mail.com', 'whatever123', 'User')).rejects.toThrow(
        'terdaftar dengan Google'
      );
    });

    it('should reject password login when account has no password and no Google link', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: 'usr_n',
        email: 'n@mail.com',
        password: null,
        googleId: null,
        isBanned: false,
        role: 'User',
      } as any);

      await expect(AuthService.login('n@mail.com', 'whatever123', 'User')).rejects.toThrow(
        'belum memiliki kata sandi'
      );
    });
  });
});
