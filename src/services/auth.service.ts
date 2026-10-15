import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';
import { prisma } from '../config/prisma.js';
import { ENV } from '../config/env.js';
import { hashPassword, comparePassword } from '../utils/password.util.js';
import { generateToken } from '../utils/jwt.util.js';
import { normalizeHandle, getInitials } from '../utils/format.util.js';
import { EmailService } from './email.service.js';

const googleClient = new OAuth2Client(ENV.GOOGLE_CLIENT_ID);

/** Masa berlaku kode OTP & token reset (best practice: pendek, sekali pakai). */
const OTP_TTL_MS = 10 * 60 * 1000; // 10 menit
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 menit
const MAX_OTP_ATTEMPTS = 5;

/** Hash cepat untuk OTP/token yang disimpan — jangan pernah simpan plaintext. */
function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export class AuthService {
  /**
   * Login user or admin by identifier (email/handle) and password
   */
  static async login(identifier: string, password?: string, role = 'User') {
    const isEmail = identifier.includes('@') && identifier.includes('.');
    const cleanHandle = normalizeHandle(identifier);

    const user = await prisma.user.findFirst({
      where: isEmail
        ? { email: { equals: identifier, mode: 'insensitive' } }
        : {
            OR: [
              { handle: { equals: cleanHandle, mode: 'insensitive' } },
              { username: { equals: identifier, mode: 'insensitive' } },
            ],
          },
      include: {
        managedBases: {
          select: { handle: true },
        },
      },
    });

    if (!user) {
      const err: any = new Error('Email atau username tidak ditemukan');
      err.status = 401;
      err.code = 'INVALID_CREDENTIALS';
      throw err;
    }

    if (user.isBanned) {
      const err: any = new Error(`Akun telah dibekukan. Alasan: ${user.banReason || 'Pelanggaran aturan komunitas'}`);
      err.status = 403;
      err.code = 'ACCOUNT_BANNED';
      throw err;
    }

    if (user.password) {
      if (!password) {
        const err: any = new Error('Password wajib diisi');
        err.status = 401;
        err.code = 'INVALID_CREDENTIALS';
        throw err;
      }
      const isMatch = await comparePassword(password, user.password);
      if (!isMatch) {
        const err: any = new Error('Password yang dimasukkan salah');
        err.status = 401;
        err.code = 'INVALID_CREDENTIALS';
        throw err;
      }
    } else if (user.googleId) {
      // Akun Google tidak punya kata sandi — jangan pernah meloloskan login apa pun.
      const err: any = new Error(
        'Akun ini terdaftar dengan Google. Masuk lewat tombol Google, atau atur kata sandi melalui "Lupa Sandi".'
      );
      err.status = 401;
      err.code = 'PASSWORD_NOT_SET';
      throw err;
    } else {
      const err: any = new Error(
        'Akun ini belum memiliki kata sandi. Gunakan "Lupa Sandi" untuk membuat kata sandi baru.'
      );
      err.status = 401;
      err.code = 'PASSWORD_NOT_SET';
      throw err;
    }

    // Role validation
    if (role === 'Base Admin' && user.role !== 'Base Admin' && user.role !== 'Super Admin') {
      const err: any = new Error('User tidak memiliki akses sebagai Base Admin');
      err.status = 403;
      err.code = 'FORBIDDEN_ROLE';
      throw err;
    }

    if (role === 'Super Admin' && user.role !== 'Super Admin') {
      const err: any = new Error('User tidak memiliki akses sebagai Super Admin');
      err.status = 403;
      err.code = 'FORBIDDEN_ROLE';
      throw err;
    }

    const token = generateToken({
      sub: user.id,
      role: user.role,
      handle: user.handle,
      email: user.email || undefined,
    });

    return {
      user: this.serializeUser(user),
      token,
    };
  }

  /**
   * Register regular user
   */
  static async registerUser(payload: {
    email: string;
    password: string;
    username: string;
    handle: string;
    avatar?: string | null;
    bio?: string | null;
  }) {
    const cleanHandle = normalizeHandle(payload.handle);

    // Check unique email and handle
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: payload.email, mode: 'insensitive' } },
          { handle: { equals: cleanHandle, mode: 'insensitive' } },
        ],
      },
    });

    if (existing) {
      const isEmail = existing.email?.toLowerCase() === payload.email.toLowerCase();
      const err: any = new Error(isEmail ? 'Email sudah terdaftar' : 'Handle sudah digunakan oleh akun lain');
      err.status = 409;
      err.code = 'CONFLICT';
      throw err;
    }

    const hashedPassword = await hashPassword(payload.password);

    const user = await prisma.user.create({
      data: {
        email: payload.email,
        password: hashedPassword,
        username: payload.username.trim(),
        handle: cleanHandle,
        avatar: payload.avatar || null,
        bio: payload.bio || 'Secret sender & casual reader di FessHub.',
        role: 'User',
        badges: ['NEW MEMBER', 'ANON SENDER'],
      },
      include: {
        managedBases: { select: { handle: true } },
      },
    });

    const token = generateToken({
      sub: user.id,
      role: user.role,
      handle: user.handle,
      email: user.email || undefined,
    });

    return {
      user: this.serializeUser(user),
      token,
    };
  }

  /**
   * Register Base Admin and create initial Base
   */
  static async registerBase(payload: {
    email: string;
    password: string;
    name: string;
    handle: string;
    avatar?: string | null;
    bio?: string | null;
    igAccount?: string | null;
    category?: string;
    color?: string;
    keyword?: string | null;
  }) {
    const cleanHandle = normalizeHandle(payload.handle);
    const cleanIg = payload.igAccount ? normalizeHandle(payload.igAccount) : null;

    // Check unique email, user handle, or base handle
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: payload.email, mode: 'insensitive' } },
          { handle: { equals: cleanHandle, mode: 'insensitive' } },
        ],
      },
    });

    const existingBase = await prisma.base.findUnique({
      where: { handle: cleanHandle },
    });

    if (existing || existingBase) {
      const err: any = new Error('Email atau handle base sudah dipakai');
      err.status = 409;
      err.code = 'CONFLICT';
      throw err;
    }

    const hashedPassword = await hashPassword(payload.password);

    // Create user and base in transaction
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: payload.email,
          password: hashedPassword,
          username: payload.name.trim(),
          handle: cleanHandle,
          avatar: payload.avatar || null,
          bio: payload.bio || `Base resmi komunitas ${cleanHandle}.`,
          role: 'Base Admin',
          igAccount: cleanIg,
          badges: ['BASE CREATOR', 'VERIFIED ADMIN'],
        },
      });

      const base = await tx.base.create({
        data: {
          name: payload.name.trim(),
          handle: cleanHandle,
          category: payload.category || 'Umum',
          color: payload.color || '#0055FF',
          keyword: payload.keyword || `[${payload.name.slice(0, 4).toLowerCase()}]`,
          avatar: payload.avatar || null,
          initial: getInitials(payload.name),
          bio: payload.bio || `Base resmi komunitas ${cleanHandle}.`,
          igAccount: cleanIg,
          creatorId: user.id,
          verified: true,
          membersCount: 1,
        },
      });

      // Auto-connect Instagram platform connection if igAccount provided
      if (cleanIg) {
        await tx.platformConnection.create({
          data: {
            userId: user.id,
            baseId: base.id,
            platform: 'instagram',
            name: 'Instagram Graph API',
            status: 'connected',
            connected: true,
            accountHandle: cleanIg,
          },
        });
      }

      return { user, base };
    });

    const userWithBases = {
      ...result.user,
      managedBases: [{ handle: result.base.handle }],
    };

    const token = generateToken({
      sub: result.user.id,
      role: result.user.role,
      handle: result.user.handle,
      email: result.user.email || undefined,
    });

    return {
      user: this.serializeUser(userWithBases),
      token,
    };
  }

  /**
   * Login or auto-register via Google OAuth ID Token
   */
  static async loginGoogle(idToken: string, role = 'User') {
    if (!ENV.GOOGLE_CLIENT_ID || !ENV.GOOGLE_CLIENT_SECRET) {
      const err: any = new Error('Login Google belum dikonfigurasi di server');
      err.status = 503;
      err.code = 'GOOGLE_NOT_CONFIGURED';
      throw err;
    }

    // Verify the ID token against Google — no unverified fallbacks.
    let email: string | undefined;
    let name: string | undefined;
    let picture: string | undefined;
    let googleSub: string | undefined;

    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: ENV.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      email = payload?.email;
      name = payload?.name;
      picture = payload?.picture;
      googleSub = payload?.sub;
    } catch {
      const err: any = new Error('Token Google tidak valid atau telah kedaluwarsa');
      err.status = 401;
      err.code = 'INVALID_GOOGLE_TOKEN';
      throw err;
    }

    if (!email || !googleSub) {
      const err: any = new Error('Akun Google tidak mengembalikan alamat email');
      err.status = 401;
      err.code = 'GOOGLE_EMAIL_MISSING';
      throw err;
    }

    // Find or create user
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { googleId: googleSub },
          { email: { equals: email, mode: 'insensitive' } },
        ],
      },
      include: {
        managedBases: { select: { handle: true } },
      },
    });

    if (user?.isBanned) {
      const err: any = new Error(
        `Akun telah dibekukan. Alasan: ${user.banReason || 'Pelanggaran aturan komunitas'}`
      );
      err.status = 403;
      err.code = 'ACCOUNT_BANNED';
      throw err;
    }

    if (!user) {
      const rawHandle = '@' + (name?.toLowerCase().replace(/[^a-z0-9_]/g, '') || `user_${Date.now()}`);
      let cleanHandle = rawHandle.slice(0, 20);

      const existingHandle = await prisma.user.findUnique({ where: { handle: cleanHandle } });
      if (existingHandle) {
        cleanHandle = `@u_${Date.now().toString().slice(-6)}`;
      }

      user = await prisma.user.create({
        data: {
          email,
          username: name || 'Pengguna Google',
          handle: cleanHandle,
          avatar: picture || null,
          role: role === 'Base Admin' ? 'Base Admin' : 'User',
          googleId: googleSub,
          badges: ['GOOGLE VERIFIED', 'MEMBER'],
        },
        include: {
          managedBases: { select: { handle: true } },
        },
      });
    } else if (!user.googleId) {
      // Link the Google identity to the existing email account
      await prisma.user.update({
        where: { id: user.id },
        data: { googleId: googleSub },
      });
      // Keep the previously included relation payload intact
      user.googleId = googleSub;
    }

    const token = generateToken({
      sub: user.id,
      role: user.role,
      handle: user.handle,
      email: user.email || undefined,
    });

    return {
      user: this.serializeUser(user),
      token,
    };
  }

  /**
   * Langkah 1 reset kata sandi: buat kode OTP & kirim ke email.
   *
   * Selalu mengembalikan pesan generik yang sama agar penyerang tidak bisa
   * memakai endpoint ini untuk menebak email mana yang terdaftar. Bila email
   * tidak terdaftar, tidak ada apa pun yang dikirim.
   */
  static async forgotPassword(email: string) {
    const genericMessage =
      'Jika email tersebut terdaftar, kode OTP telah dikirim. Periksa inbox (dan folder spam).';

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true, email: true },
    });
    if (!user?.email) return { message: genericMessage };

    const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Satu baris per user: minta ulang OTP = timpa kode lama + reset percobaan.
    await prisma.passwordReset.upsert({
      where: { userId: user.id },
      create: { userId: user.id, otpHash: sha256(otp), otpExpiresAt },
      update: {
        otpHash: sha256(otp),
        otpExpiresAt,
        attempts: 0,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    });

    if (EmailService.isConfigured()) {
      await EmailService.sendPasswordResetOtp(user.email, otp);
      return { message: genericMessage };
    }

    // SMTP belum diatur: production TIDAK boleh membocorkan OTP —
    // development dikembalikan agar alur tetap bisa diuji tanpa email.
    if (ENV.NODE_ENV === 'production') {
      const err: any = new Error('Layanan email belum dikonfigurasi di server. Hubungi admin.');
      err.status = 503;
      err.code = 'EMAIL_NOT_CONFIGURED';
      throw err;
    }

    console.info(`[DEV] Kode OTP reset kata sandi untuk ${user.email}: ${otp}`);
    return { message: genericMessage, dev_otp: otp };
  }

  /**
   * Langkah 2 reset kata sandi: verifikasi kode OTP → token reset sekali pakai.
   */
  static async verifyResetOtp(email: string, otp: string) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    const record = user
      ? await prisma.passwordReset.findUnique({ where: { userId: user.id } })
      : null;

    if (!user || !record) {
      const err: any = new Error('Kode OTP tidak valid atau sudah kedaluwarsa. Minta kode baru.');
      err.status = 401;
      err.code = 'INVALID_OTP';
      throw err;
    }

    if (record.otpExpiresAt.getTime() < Date.now()) {
      const err: any = new Error('Kode OTP sudah kedaluwarsa. Minta kode baru.');
      err.status = 401;
      err.code = 'OTP_EXPIRED';
      throw err;
    }

    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      const err: any = new Error('Terlalu banyak percobaan salah. Minta kode OTP baru.');
      err.status = 429;
      err.code = 'TOO_MANY_ATTEMPTS';
      throw err;
    }

    if (sha256(otp) !== record.otpHash) {
      await prisma.passwordReset.update({
        where: { userId: user.id },
        data: { attempts: { increment: 1 } },
      });
      const err: any = new Error('Kode OTP salah. Periksa kembali kode di emailmu.');
      err.status = 401;
      err.code = 'INVALID_OTP';
      throw err;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    await prisma.passwordReset.update({
      where: { userId: user.id },
      data: {
        resetTokenHash: sha256(resetToken),
        resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        attempts: 0,
      },
    });

    return {
      reset_token: resetToken,
      message: 'Kode OTP terverifikasi. Silakan buat kata sandi baru.',
    };
  }

  /**
   * Langkah 3 reset kata sandi: simpan kata sandi baru (token sekali pakai).
   */
  static async resetPassword(email: string, resetToken: string, password: string) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    const record = user
      ? await prisma.passwordReset.findUnique({ where: { userId: user.id } })
      : null;

    const invalidSession = () => {
      const err: any = new Error(
        'Sesi reset tidak valid atau sudah kedaluwarsa. Ulangi proses dari awal.'
      );
      err.status = 401;
      err.code = 'INVALID_RESET_TOKEN';
      return err;
    };

    if (!user || !record?.resetTokenHash || !record.resetTokenExpiresAt) {
      throw invalidSession();
    }

    if (record.resetTokenExpiresAt.getTime() < Date.now()) throw invalidSession();
    if (sha256(resetToken) !== record.resetTokenHash) throw invalidSession();

    const hashedPassword = await hashPassword(password);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword } }),
      // Token sekali pakai — hapus agar tidak bisa dipakai ulang.
      prisma.passwordReset.delete({ where: { userId: user.id } }),
    ]);

    return { ok: true, message: 'Kata sandi berhasil diperbarui. Silakan masuk kembali.' };
  }

  /**
   * Get user by ID (for GET /auth/me)
   */
  static async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        managedBases: { select: { handle: true } },
      },
    });

    if (!user) {
      const err: any = new Error('Pengguna tidak ditemukan');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    return this.serializeUser(user);
  }

  /**
   * Helper to format User model into exact OpenAPI User schema shape
   */
  static serializeUser(user: any) {
    return {
      id: user.id,
      username: user.username,
      handle: user.handle,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      level: user.level ?? 1,
      bio: user.bio,
      badges: user.badges || [],
      managed_bases: user.managedBases ? user.managedBases.map((b: any) => b.handle) : [],
      ig_account: user.igAccount,
      followers_count: user.followersCount ?? 0,
      following_count: user.followingCount ?? 0,
      fess_count: user.fessCount ?? 0,
      balance: user.balance ?? 0,
      revenue: user.revenue ?? 0,
      created_at: user.createdAt ? new Date(user.createdAt).getTime() : Date.now(),
    };
  }
}
