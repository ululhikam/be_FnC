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
  banExpiresAt: true,
  managedBases: { select: { handle: true }, orderBy: { createdAt: 'asc' } },
  ctfWallet: { select: { balance: true } },
} as const;

function findAuthUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: AUTH_USER_SELECT,
  });
}

type AuthUserRecord = NonNullable<Awaited<ReturnType<typeof findAuthUser>>>;

/** A timed ban stops blocking the account when its expiry passes. */
function hasActiveBan(user: { isBanned: boolean; banExpiresAt: Date | null }) {
  return Boolean(
    user.isBanned && (!user.banExpiresAt || user.banExpiresAt.getTime() > Date.now())
  );
}

async function clearExpiredBan(user: AuthUserRecord) {
  if (!user.isBanned || !user.banExpiresAt || user.banExpiresAt.getTime() > Date.now()) {
    return user;
  }

  await prisma.user
    .update({
      where: { id: user.id },
      data: { isBanned: false, banReason: null, banExpiresAt: null },
    })
    .catch(() => undefined);

  user.isBanned = false;
  return user;
}

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

/**
 * Payment/top-up requires a real, verified email. Anonymous Instagram-only
 * accounts are intentionally excluded from paid flows.
 */
export function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return errorResponse(res, 'Autentikasi dibutuhkan.', 401, 'UNAUTHORIZED');
  }
  if (!req.user.email) {
    return errorResponse(
      res,
      'Tambahkan dan verifikasi email sebelum melakukan top-up.',
      403,
      'EMAIL_REQUIRED'
    );
  }
  if (!req.user.emailVerifiedAt) {
    return errorResponse(
      res,
      'Verifikasi email diperlukan sebelum melakukan top-up.',
      403,
      'EMAIL_NOT_VERIFIED'
    );
  }
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse(res, 'Autentikasi dibutuhkan. Silakan login terlebih dahulu.', 401, 'UNAUTHORIZED');
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = verifyToken(token);
    const found = await findAuthUser(payload.sub);
    const user = found ? await clearExpiredBan(found) : null;

    if (!user || hasActiveBan(user)) {
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
    const found = await findAuthUser(payload.sub);
    const user = found ? await clearExpiredBan(found) : null;

    if (user && !hasActiveBan(user) && (!user.email || user.emailVerifiedAt)) {
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

/**
 * Base ownership operations (create base, edit base settings, change bank,
 * request payout) are Base Admin duties. Super Admin has god-mode access to
 * read/support endpoints, but must not silently perform base-owned writes.
 */
export function requireBaseAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return errorResponse(res, 'Autentikasi dibutuhkan.', 401, 'UNAUTHORIZED');
  }
  if (req.user.role !== 'Base Admin') {
    return errorResponse(
      res,
      'Aksi ini hanya dapat dilakukan oleh Base Admin. Super Admin memiliki akses baca untuk dukungan base.',
      403,
      'BASE_ADMIN_ONLY'
    );
  }
  next();
}
