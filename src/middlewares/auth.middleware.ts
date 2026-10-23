import { Request, Response, NextFunction } from 'express';
import { generateEmailVerificationTicket, verifyToken } from '../utils/jwt.util.js';
import { errorResponse } from '../utils/response.util.js';
import { prisma } from '../config/prisma.js';

export interface AuthenticatedUser {
  id: string;
  username: string;
  handle: string;
  email?: string | null;
  emailVerifiedAt?: Date | null;
  role: string;
  avatar?: string | null;
  level: number;
  bio?: string | null;
  badges: string[];
  managedBases?: string[];
  igAccount?: string | null;
  followersCount?: number;
  followingCount?: number;
  fessCount?: number;
  balance?: number;
  revenue?: number;
  createdAt?: Date | string | null;
  handleChangedAt?: Date | null;
}

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends AuthenticatedUser {}
  }
}

/**
 * Kolom yang benar-benar dipakai request handler. Tanpa `select`, Prisma
 * mengambil seluruh kolom User (termasuk password/hash OAuth) pada setiap
 * request terautentikasi. Relasi managedBases tetap diambil karena dipakai
 * untuk otorisasi Base Admin.
 */
const AUTH_USER_SELECT = {
  id: true,
  username: true,
  handle: true,
  email: true,
  emailVerifiedAt: true,
  role: true,
  avatar: true,
  level: true,
  bio: true,
  badges: true,
  igAccount: true,
  followersCount: true,
  followingCount: true,
  fessCount: true,
  balance: true,
  revenue: true,
  createdAt: true,
  handleChangedAt: true,
  isBanned: true,
  managedBases: { select: { handle: true } },
  ctfWallet: { select: { balance: true } },
} as const;

function findAuthUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: AUTH_USER_SELECT,
  });
}

type AuthUserRecord = NonNullable<Awaited<ReturnType<typeof findAuthUser>>>;

function toAuthenticatedUser(user: AuthUserRecord): AuthenticatedUser {
  return {
    id: user.id,
    username: user.username,
    handle: user.handle,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    role: user.role,
    avatar: user.avatar,
    level: user.level,
    bio: user.bio,
    badges: user.badges,
    managedBases: user.managedBases.map((base) => base.handle),
    igAccount: user.igAccount,
    followersCount: user.followersCount,
    followingCount: user.followingCount,
    fessCount: user.fessCount,
    balance: user.ctfWallet?.balance ?? user.balance,
    revenue: user.revenue,
    createdAt: user.createdAt,
    handleChangedAt: user.handleChangedAt,
  };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse(res, 'Autentikasi dibutuhkan. Silakan login terlebih dahulu.', 401, 'UNAUTHORIZED');
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = verifyToken(token);
    const user = await findAuthUser(payload.sub);

    if (!user || user.isBanned) {
      return errorResponse(res, 'Sesi tidak valid atau akun telah dibekukan.', 401, 'UNAUTHORIZED');
    }

    // JWT lama tetap bisa terbaca, tetapi akun yang emailnya belum diverifikasi
    // tidak boleh mengakses data apa pun. Frontend memakai ticket di bawah untuk
    // melanjutkan ke halaman verifikasi tanpa perlu login ulang.
    if (user.email && !user.emailVerifiedAt) {
      return res.status(403).json({
        message: 'Verifikasi email diperlukan sebelum melanjutkan.',
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
        verification_ticket: generateEmailVerificationTicket({
          sub: user.id,
          role: user.role,
          email: user.email,
        }),
      });
    }

    req.user = toAuthenticatedUser(user);

    next();
  } catch (error) {
    return errorResponse(res, 'Token tidak valid atau telah kedaluwarsa.', 401, 'TOKEN_EXPIRED');
  }
}

export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = verifyToken(token);
    const user = await findAuthUser(payload.sub);

    if (user && !user.isBanned && (!user.email || user.emailVerifiedAt)) {
      req.user = toAuthenticatedUser(user);
    }
  } catch {
    // Ignore invalid token on optional auth
  }

  next();
}

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return errorResponse(res, 'Autentikasi dibutuhkan.', 401, 'UNAUTHORIZED');
    }

    // Super Admin has god mode access
    if (req.user.role === 'Super Admin') {
      return next();
    }

    if (!allowedRoles.includes(req.user.role)) {
      return errorResponse(res, 'Anda tidak memiliki izin untuk mengakses resource ini.', 403, 'FORBIDDEN');
    }

    next();
  };
}
