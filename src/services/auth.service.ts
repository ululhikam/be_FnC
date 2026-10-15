import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../config/prisma.js';
import { ENV } from '../config/env.js';
import { hashPassword, comparePassword } from '../utils/password.util.js';
import { generateToken } from '../utils/jwt.util.js';
import { normalizeHandle, getInitials } from '../utils/format.util.js';

const googleClient = new OAuth2Client(ENV.GOOGLE_CLIENT_ID);

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

    if (password && user.password) {
      const isMatch = await comparePassword(password, user.password);
      if (!isMatch) {
        const err: any = new Error('Password yang dimasukkan salah');
        err.status = 401;
        err.code = 'INVALID_CREDENTIALS';
        throw err;
      }
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
