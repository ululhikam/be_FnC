import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.util.js';
import { errorResponse } from '../utils/response.util.js';
import { prisma } from '../config/prisma.js';

export interface AuthenticatedUser {
  id: string;
  username: string;
  handle: string;
  email?: string | null;
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
}

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends AuthenticatedUser {}
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse(res, 'Autentikasi dibutuhkan. Silakan login terlebih dahulu.', 401, 'UNAUTHORIZED');
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        managedBases: {
          select: { handle: true },
        },
      },
    });

    if (!user || user.isBanned) {
      return errorResponse(res, 'Sesi tidak valid atau akun telah dibekukan.', 401, 'UNAUTHORIZED');
    }

    req.user = {
      id: user.id,
      username: user.username,
      handle: user.handle,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      level: user.level,
      bio: user.bio,
      badges: user.badges,
      managedBases: user.managedBases.map((b) => b.handle),
      igAccount: user.igAccount,
      followersCount: user.followersCount,
      followingCount: user.followingCount,
      fessCount: user.fessCount,
      balance: user.balance,
      revenue: user.revenue,
    };

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
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        managedBases: {
          select: { handle: true },
        },
      },
    });

    if (user && !user.isBanned) {
      req.user = {
        id: user.id,
        username: user.username,
        handle: user.handle,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        level: user.level,
        bio: user.bio,
        badges: user.badges,
        managedBases: user.managedBases.map((b) => b.handle),
        igAccount: user.igAccount,
        followersCount: user.followersCount,
        followingCount: user.followingCount,
        fessCount: user.fessCount,
        balance: user.balance,
        revenue: user.revenue,
      };
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
