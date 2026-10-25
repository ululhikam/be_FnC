import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { comparePassword } from '../utils/password.util.js';

type DbClient = Prisma.TransactionClient | typeof prisma;

export type AuditLogInput = {
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export class AdminSecurityError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'AdminSecurityError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Shared guardrails for high-risk Super Admin actions. These actions must not
 * rely on the normal session alone: the server verifies the current password
 * again and writes an immutable audit record.
 */
export class AdminSecurityService {
  static async assertReauth(userId: string, password?: string | null) {
    if (!password || !String(password).trim()) {
      throw new AdminSecurityError(
        'REAUTH_REQUIRED',
        'Konfirmasi kata sandi diperlukan untuk aksi admin berisiko tinggi',
        401
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password: true, isBanned: true, banExpiresAt: true },
    });

    const activeBan = Boolean(
      user?.isBanned && (!user.banExpiresAt || user.banExpiresAt.getTime() > Date.now())
    );
    if (!user || activeBan) {
      throw new AdminSecurityError('UNAUTHORIZED', 'Akun admin tidak valid', 401);
    }
    if (!user.password) {
      throw new AdminSecurityError(
        'REAUTH_UNAVAILABLE',
        'Akun ini tidak memiliki kata sandi. Atur kata sandi sebelum melakukan aksi berisiko tinggi.',
        409
      );
    }

    const valid = await comparePassword(String(password), user.password);
    if (!valid) {
      throw new AdminSecurityError(
        'REAUTH_INVALID',
        'Kata sandi konfirmasi salah. Aksi dibatalkan.',
        403
      );
    }
  }

  static async writeAudit(input: AuditLogInput, tx?: Prisma.TransactionClient) {
    const client: DbClient = tx ?? prisma;
    return client.adminAuditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        reason: input.reason ?? null,
        metadata: input.metadata,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }

  /** Alert visible in the Super Admin engine log, in addition to the audit row. */
  static async writeAlert(
    source: string,
    message: string,
    tone: 'ok' | 'info' | 'muted' | 'error' = 'info'
  ) {
    await prisma.systemLog
      .create({ data: { source, message, tone } })
      .catch((error) => {
        console.error('[AdminAlert] Gagal menulis system log:', error);
      });
  }
}
