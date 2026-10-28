import { prisma } from '../config/prisma.js';
import { ENV } from '../config/env.js';
import { rateLimitConfig } from '../middlewares/rateLimit.middleware.js';
import { BASE_PAYOUT_MIN_IDR, CTF_PER_PAID_FESS } from '../constants/payments.js';
import { normalizeHandle } from '../utils/format.util.js';
import { AdminSecurityService } from './admin-security.service.js';
import { BaseRevenueService, type RequestMeta } from './base-revenue.service.js';

type PlatformActor = {
  id: string;
  role: string;
};

type Pagination = {
  page?: number;
  limit?: number;
};

type DateRange = {
  from?: string | null;
  to?: string | null;
};

function fail(status: number, code: string, message: string): never {
  const error: any = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function maskAccountNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = String(value).replace(/\s+/g, '');
  if (clean.length <= 4) return `****${clean}`;
  return `${'*'.repeat(Math.max(0, clean.length - 4))}${clean.slice(-4)}`;
}

function pageArgs({ page, limit }: Pagination) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
}

function dateRangeWhere(range: DateRange) {
  const where: Record<string, Date> = {};
  if (range.from) {
    const from = new Date(range.from);
    if (Number.isFinite(from.getTime())) where.gte = from;
  }
  if (range.to) {
    const to = new Date(range.to);
    if (Number.isFinite(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      where.lte = to;
    }
  }
  return Object.keys(where).length ? where : undefined;
}

function activeBan(user: { isBanned: boolean; banExpiresAt: Date | null }) {
  return Boolean(
    user.isBanned && (!user.banExpiresAt || user.banExpiresAt.getTime() > Date.now())
  );
}

export class PlatformAdminService {
  /**
   * One request powers the platform overview: real health, queue counts,
   * financial snapshot, environment flags and the newest audit activity.
   */
  static async getOpsSummary() {
    const startedAt = Date.now();
    let dbLatencyMs: number | null = null;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - startedAt;
    } catch {
      dbLatencyMs = null;
    }

    await BaseRevenueService.releaseMatured().catch(() => undefined);

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const stalePaymentBefore = new Date(now.getTime() - 60 * 60 * 1000);

    const [
      payoutsRequested,
      payoutsApprovedWaitingTransfer,
      kycAttention,
      paymentsPendingStale,
      paymentEventsFailed24h,
      bannedUsers,
      errors24h,
      totalUsers,
      totalBases,
      walletTotals,
      oldestPayout,
      lastSystemLog,
      recentAudit,
      recentLogs,
    ] = await Promise.all([
      prisma.basePayout.count({ where: { status: 'REQUESTED' } }),
      prisma.basePayout.count({ where: { status: 'APPROVED' } }),
      prisma.base.count({
        where: {
          payoutKycStatus: { not: 'verified' },
          payoutBankName: { not: null },
          payoutBankAccountName: { not: null },
          payoutBankAccountNumber: { not: null },
          revenueWallet: { is: { availableIdr: { gte: BASE_PAYOUT_MIN_IDR } } },
        },
      }),
      prisma.paymentOrder.count({
        where: {
          status: 'PENDING',
          OR: [{ expiresAt: { lt: now } }, { createdAt: { lt: stalePaymentBefore } }],
        },
      }),
      prisma.paymentEvent.count({
        where: {
          status: { in: ['INVALID_SIGNATURE', 'FAILED'] },
          createdAt: { gte: last24h },
        },
      }),
      prisma.user.count({
        where: {
          isBanned: true,
          OR: [{ banExpiresAt: null }, { banExpiresAt: { gt: now } }],
        },
      }),
      prisma.systemLog.count({ where: { tone: 'error', createdAt: { gte: last24h } } }),
      prisma.user.count(),
      prisma.base.count(),
      prisma.baseRevenueWallet.aggregate({
        _sum: {
          pendingIdr: true,
          availableIdr: true,
          reservedIdr: true,
          lifetimeIdr: true,
        },
      }),
      prisma.basePayout.findFirst({
        where: { status: 'REQUESTED' },
        orderBy: { requestedAt: 'asc' },
        select: { requestedAt: true },
      }),
      prisma.systemLog.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.adminAuditLog.findMany({
        take: 6,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: { select: { id: true, handle: true, username: true, avatar: true } },
        },
      }),
      prisma.systemLog.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      generated_at: now.toISOString(),
      environment: {
        node_env: ENV.NODE_ENV,
        payments_enabled: ENV.PAYMENTS_ENABLED,
        base_payouts_enabled: ENV.BASE_PAYOUTS_ENABLED,
        midtrans_is_production: ENV.MIDTRANS_IS_PRODUCTION,
      },
      health: {
        status: dbLatencyMs === null ? 'error' : errors24h > 5 ? 'degraded' : 'ok',
        db_latency_ms: dbLatencyMs,
        last_system_log_at: asIso(lastSystemLog?.createdAt),
        errors_24h: errors24h,
      },
      counts: {
        payouts_requested: payoutsRequested,
        payouts_approved_waiting_transfer: payoutsApprovedWaitingTransfer,
        kyc_attention: kycAttention,
        payments_pending_stale: paymentsPendingStale,
        payment_events_failed_24h: paymentEventsFailed24h,
        banned_users: bannedUsers,
      },
      finance: {
        pending_idr: walletTotals._sum.pendingIdr ?? 0,
        available_idr: walletTotals._sum.availableIdr ?? 0,
        reserved_idr: walletTotals._sum.reservedIdr ?? 0,
        lifetime_idr: walletTotals._sum.lifetimeIdr ?? 0,
      },
      oldest: {
        payout_requested_at: asIso(oldestPayout?.requestedAt),
      },
      totals: {
        users: totalUsers,
        bases: totalBases,
      },
      recent_audit: recentAudit.map((entry) => ({
        id: entry.id,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        reason: entry.reason,
        created_at: asIso(entry.createdAt),
        actor: entry.actor
          ? {
              id: entry.actor.id,
              handle: entry.actor.handle,
              username: entry.actor.username,
              avatar: entry.actor.avatar,
            }
          : null,
      })),
      recent_logs: recentLogs.map((log) => ({
        id: log.id,
        source: log.source,
        message: log.message,
        tone: log.tone,
        created_at: asIso(log.createdAt),
      })),
    };
  }

  static async listAuditLogs(
    filters: Pagination &
      DateRange & {
        q?: string;
        action?: string;
        target_type?: string;
        actor?: string;
      } = {}
  ) {
    const { page, limit, skip } = pageArgs(filters);
    const createdAt = dateRangeWhere(filters);
    const where: any = {
      ...(createdAt ? { createdAt } : {}),
      ...(filters.action
        ? { action: { contains: filters.action, mode: 'insensitive' } }
        : {}),
      ...(filters.target_type ? { targetType: filters.target_type } : {}),
      ...(filters.q
        ? {
            OR: [
              { action: { contains: filters.q, mode: 'insensitive' } },
              { targetType: { contains: filters.q, mode: 'insensitive' } },
              { targetId: { contains: filters.q, mode: 'insensitive' } },
              { reason: { contains: filters.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(filters.actor
        ? {
            actor: {
              is: {
                OR: [
                  { handle: { contains: filters.actor, mode: 'insensitive' } },
                  { username: { contains: filters.actor, mode: 'insensitive' } },
                  { email: { contains: filters.actor, mode: 'insensitive' } },
                ],
              },
            },
          }
        : {}),
    };

    const [total, entries] = await Promise.all([
      prisma.adminAuditLog.count({ where }),
      prisma.adminAuditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: { select: { id: true, handle: true, username: true, email: true, avatar: true } },
        },
      }),
    ]);

    return {
      data: entries.map((entry) => ({
        id: entry.id,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        reason: entry.reason,
        metadata: entry.metadata,
        ip_address: entry.ipAddress,
        user_agent: entry.userAgent,
        created_at: asIso(entry.createdAt),
        actor: entry.actor
          ? {
              id: entry.actor.id,
              handle: entry.actor.handle,
              username: entry.actor.username,
              email: entry.actor.email,
              avatar: entry.actor.avatar,
            }
          : null,
      })),
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    };
  }

  static async listUsers(
    filters: Pagination & {
      q?: string;
      role?: string;
      banned?: boolean;
      email_verified?: boolean;
    } = {}
  ) {
    const { page, limit, skip } = pageArgs(filters);
    const now = new Date();
    const and: any[] = [];

    if (filters.q) {
      and.push({
        OR: [
          { handle: { contains: filters.q, mode: 'insensitive' } },
          { username: { contains: filters.q, mode: 'insensitive' } },
          { email: { contains: filters.q, mode: 'insensitive' } },
          { id: filters.q },
        ],
      });
    }
    if (filters.role) and.push({ role: filters.role });
    if (filters.banned === true) {
      and.push({
        isBanned: true,
        OR: [{ banExpiresAt: null }, { banExpiresAt: { gt: now } }],
      });
    } else if (filters.banned === false) {
      and.push({
        OR: [
          { isBanned: false },
          { banExpiresAt: { lte: now } },
        ],
      });
    }
    if (filters.email_verified === true) and.push({ emailVerifiedAt: { not: null } });
    if (filters.email_verified === false) and.push({ emailVerifiedAt: null });

    const where: any = and.length ? { AND: and } : {};

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          handle: true,
          username: true,
          email: true,
          emailVerifiedAt: true,
          role: true,
          avatar: true,
          level: true,
          isBanned: true,
          banReason: true,
          banExpiresAt: true,
          createdAt: true,
          managedBases: { select: { id: true, handle: true, name: true } },
          ctfWallet: { select: { balance: true } },
          _count: { select: { fesses: true, paymentOrders: true } },
        },
      }),
    ]);

    return {
      data: users.map((user) => ({
        id: user.id,
        handle: user.handle,
        username: user.username,
        email: user.email,
        email_verified_at: asIso(user.emailVerifiedAt),
        role: user.role,
        avatar: user.avatar,
        level: user.level,
        is_banned: user.isBanned,
        ban_active: activeBan(user),
        ban_reason: user.banReason,
        ban_expires_at: asIso(user.banExpiresAt),
        created_at: asIso(user.createdAt),
        ctf_balance: user.ctfWallet?.balance ?? 0,
        fess_count: user._count.fesses,
        payment_order_count: user._count.paymentOrders,
        managed_bases: user.managedBases.map((base) => ({
          id: base.id,
          handle: base.handle,
          name: base.name,
        })),
      })),
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    };
  }

  static async banUser(
    actor: PlatformActor,
    userId: string,
    input: { reason: string; durationHours?: number; password?: string | null },
    meta: RequestMeta = {}
  ) {
    if (!input.reason || !String(input.reason).trim()) {
      fail(422, 'REASON_REQUIRED', 'Alasan ban wajib diisi');
    }
    if (actor.id === userId) {
      fail(422, 'CANNOT_BAN_SELF', 'Super Admin tidak dapat mem-ban akun sendiri');
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, handle: true, username: true, isBanned: true },
    });
    if (!target) fail(404, 'USER_NOT_FOUND', 'User tidak ditemukan');
    if (target.role === 'Super Admin') {
      fail(403, 'CANNOT_BAN_SUPER_ADMIN', 'Super Admin tidak dapat mem-ban Super Admin lain');
    }

    await AdminSecurityService.assertReauth(actor.id, input.password);

    const durationHours = Math.max(0, Number(input.durationHours) || 0);
    const banExpiresAt =
      durationHours > 0 ? new Date(Date.now() + durationHours * 60 * 60 * 1000) : null;
    const reason = String(input.reason).trim();

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.user.update({
        where: { id: userId },
        data: { isBanned: true, banReason: reason, banExpiresAt },
        select: {
          id: true,
          handle: true,
          username: true,
          email: true,
          role: true,
          isBanned: true,
          banReason: true,
          banExpiresAt: true,
        },
      });

      await AdminSecurityService.writeAudit(
        {
          actorId: actor.id,
          action: 'ADMIN_USER_BANNED',
          targetType: 'User',
          targetId: userId,
          reason,
          metadata: {
            target_handle: target.handle,
            duration_hours: durationHours,
            ban_expires_at: asIso(banExpiresAt),
            previous_ban: target.isBanned,
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        tx
      );

      return saved;
    });

    await AdminSecurityService.writeAlert(
      'SECURITY',
      `User ${target.handle} diblokir oleh Super Admin ${actor.id}. Alasan: ${reason}`,
      'error'
    );

    return {
      id: updated.id,
      handle: updated.handle,
      username: updated.username,
      email: updated.email,
      role: updated.role,
      is_banned: updated.isBanned,
      ban_reason: updated.banReason,
      ban_expires_at: asIso(updated.banExpiresAt),
    };
  }

  static async unbanUser(
    actor: PlatformActor,
    userId: string,
    input: { reason?: string | null; password?: string | null },
    meta: RequestMeta = {}
  ) {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, handle: true, isBanned: true },
    });
    if (!target) fail(404, 'USER_NOT_FOUND', 'User tidak ditemukan');
    if (actor.id === userId) {
      fail(422, 'CANNOT_UNBAN_SELF', 'Super Admin tidak dapat mengubah status ban sendiri');
    }

    await AdminSecurityService.assertReauth(actor.id, input.password);
    const reason = String(input.reason || '').trim() || null;

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.user.update({
        where: { id: userId },
        data: { isBanned: false, banReason: null, banExpiresAt: null },
        select: {
          id: true,
          handle: true,
          username: true,
          email: true,
          role: true,
          isBanned: true,
          banReason: true,
          banExpiresAt: true,
        },
      });

      await AdminSecurityService.writeAudit(
        {
          actorId: actor.id,
          action: 'ADMIN_USER_UNBANNED',
          targetType: 'User',
          targetId: userId,
          reason,
          metadata: { target_handle: target.handle, previous_ban: target.isBanned },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        tx
      );

      return saved;
    });

    await AdminSecurityService.writeAlert(
      'SECURITY',
      `User ${target.handle} dibuka blokirnya oleh Super Admin ${actor.id}.`,
      'info'
    );

    return {
      id: updated.id,
      handle: updated.handle,
      username: updated.username,
      email: updated.email,
      role: updated.role,
      is_banned: updated.isBanned,
      ban_reason: updated.banReason,
      ban_expires_at: asIso(updated.banExpiresAt),
    };
  }

  /**
   * Read-only support view. Deliberately returns no mutation affordances and
   * no platform secrets. Bank details are visible only to Super Admin finance.
   */
  static async getBaseSupport(handle: string) {
    const cleanHandle = normalizeHandle(handle);
    const base = await prisma.base.findUnique({
      where: { handle: cleanHandle },
      include: {
        creator: {
          select: { id: true, handle: true, username: true, email: true, avatar: true },
        },
        revenueWallet: true,
        payouts: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            requestedBy: { select: { handle: true } },
            reviewedBy: { select: { handle: true } },
          },
        },
        connections: {
          select: {
            platform: true,
            connected: true,
            accountHandle: true,
            metadata: true,
            updatedAt: true,
          },
        },
        _count: { select: { fesses: true, followers: true, payouts: true } },
      },
    });
    if (!base) fail(404, 'BASE_NOT_FOUND', 'Base tidak ditemukan');

    const audit = await prisma.adminAuditLog.findMany({
      where: { targetType: 'Base', targetId: base.id },
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { handle: true, username: true } } },
    });

    const bankComplete = Boolean(
      base.payoutBankName && base.payoutBankAccountName && base.payoutBankAccountNumber
    );
    const bankEffectiveAt = base.payoutBankChangeEffectiveAt
      ? new Date(base.payoutBankChangeEffectiveAt).getTime()
      : null;

    return {
      generated_at: new Date().toISOString(),
      base: {
        id: base.id,
        handle: base.handle,
        name: base.name,
        category: base.category,
        bio: base.bio,
        avatar: base.avatar,
        initial: base.initial,
        verified: base.verified,
        post_mode: base.postMode,
        created_at: asIso(base.createdAt),
        updated_at: asIso(base.updatedAt),
        creator: base.creator
          ? {
              id: base.creator.id,
              handle: base.creator.handle,
              username: base.creator.username,
              email: base.creator.email,
              avatar: base.creator.avatar,
            }
          : null,
      },
      billing: {
        trial_started_at: asIso(base.trialStartedAt),
        trial_ends_at: asIso(base.trialEndsAt),
        trial_source: base.trialSource,
        free_forever: base.freeForever,
        fess_price_ctf: base.freeForever ? 0 : CTF_PER_PAID_FESS,
        free_forever_reason: base.freeForeverReason,
        free_forever_set_at: asIso(base.freeForeverSetAt),
      },
      kyc: {
        status: base.payoutKycStatus,
        verified_at: asIso(base.payoutKycVerifiedAt),
        note: base.payoutKycNote,
      },
      bank: {
        bank_name: base.payoutBankName,
        account_name: base.payoutBankAccountName,
        account_number: base.payoutBankAccountNumber,
        account_number_masked: maskAccountNumber(base.payoutBankAccountNumber),
        updated_at: asIso(base.payoutBankUpdatedAt),
        change_effective_at: asIso(base.payoutBankChangeEffectiveAt),
        change_pending: Boolean(bankEffectiveAt && bankEffectiveAt > Date.now()),
        complete: bankComplete,
      },
      wallet: {
        pending_idr: base.revenueWallet?.pendingIdr ?? 0,
        available_idr: base.revenueWallet?.availableIdr ?? 0,
        reserved_idr: base.revenueWallet?.reservedIdr ?? 0,
        lifetime_idr: base.revenueWallet?.lifetimeIdr ?? 0,
      },
      stats: {
        fesses: base._count.fesses,
        followers: base._count.followers,
        payouts: base._count.payouts,
      },
      payout_ready: Boolean(
        bankComplete &&
          base.payoutKycStatus === 'verified' &&
          (!bankEffectiveAt || bankEffectiveAt <= Date.now())
      ),
      connections: base.connections.map((connection) => {
        const metadata = (connection.metadata || {}) as Record<string, unknown>;
        return {
          platform: connection.platform,
          connected: connection.connected,
          account_handle: connection.accountHandle,
          token_expires_at:
            typeof metadata.tokenExpiresAt === 'string' ? metadata.tokenExpiresAt : null,
          updated_at: asIso(connection.updatedAt),
        };
      }),
      recent_payouts: base.payouts.map((payout) => ({
        id: payout.id,
        status: payout.status.toLowerCase(),
        amount_idr: payout.amountIdr,
        fee_idr: payout.feeIdr,
        net_idr: payout.netIdr,
        reference: payout.reference,
        requested_at: asIso(payout.requestedAt),
        reviewed_at: asIso(payout.reviewedAt),
        paid_at: asIso(payout.paidAt),
        requested_by: payout.requestedBy?.handle ?? null,
        reviewed_by: payout.reviewedBy?.handle ?? null,
      })),
      recent_audit: audit.map((entry) => ({
        id: entry.id,
        action: entry.action,
        reason: entry.reason,
        created_at: asIso(entry.createdAt),
        actor: entry.actor?.handle ?? entry.actor?.username ?? null,
      })),
    };
  }

  static async listPaymentOrders(
    filters: Pagination &
      DateRange & {
        q?: string;
        status?: string;
        method?: string;
      } = {}
  ) {
    const { page, limit, skip } = pageArgs(filters);
    const createdAt = dateRangeWhere(filters);
    const and: any[] = [];
    if (createdAt) and.push({ createdAt });
    if (filters.status) and.push({ status: filters.status.toUpperCase() });
    if (filters.method) and.push({ paymentMethod: filters.method });
    if (filters.q) {
      and.push({
        OR: [
          { orderId: { contains: filters.q, mode: 'insensitive' } },
          { midtransTransactionId: { contains: filters.q, mode: 'insensitive' } },
          { user: { is: { handle: { contains: filters.q, mode: 'insensitive' } } } },
          { user: { is: { email: { contains: filters.q, mode: 'insensitive' } } } },
        ],
      });
    }
    const where: any = and.length ? { AND: and } : {};

    const [total, orders] = await Promise.all([
      prisma.paymentOrder.count({ where }),
      prisma.paymentOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, handle: true, username: true, email: true } },
        },
      }),
    ]);

    return {
      data: orders.map((order) => ({
        id: order.id,
        order_id: order.orderId,
        package_code: order.packageCode,
        package_name: order.packageName,
        amount_idr: order.amountIdr,
        ctf_amount: order.ctfAmount,
        status: order.status.toLowerCase(),
        payment_method: order.paymentMethod,
        payment_channel: order.paymentChannel,
        midtrans_status: order.midtransStatus,
        expires_at: asIso(order.expiresAt),
        paid_at: asIso(order.paidAt),
        failed_at: asIso(order.failedAt),
        last_synced_at: asIso(order.lastSyncedAt),
        created_at: asIso(order.createdAt),
        user: order.user
          ? {
              id: order.user.id,
              handle: order.user.handle,
              username: order.user.username,
              email: order.user.email,
            }
          : null,
      })),
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    };
  }

  static async getPaymentOrder(identifier: string) {
    const order = await prisma.paymentOrder.findFirst({
      where: { OR: [{ id: identifier }, { orderId: identifier }] },
      include: {
        user: { select: { id: true, handle: true, username: true, email: true } },
        events: {
          take: 30,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            orderId: true,
            eventType: true,
            status: true,
            signatureValid: true,
            ipAddress: true,
            processedAt: true,
            errorMessage: true,
            createdAt: true,
          },
        },
      },
    });
    if (!order) fail(404, 'PAYMENT_ORDER_NOT_FOUND', 'Order pembayaran tidak ditemukan');

    return {
      id: order.id,
      order_id: order.orderId,
      package_code: order.packageCode,
      package_name: order.packageName,
      amount_idr: order.amountIdr,
      ctf_amount: order.ctfAmount,
      currency: order.currency,
      status: order.status.toLowerCase(),
      payment_method: order.paymentMethod,
      payment_channel: order.paymentChannel,
      midtrans_transaction_id: order.midtransTransactionId,
      midtrans_status: order.midtransStatus,
      expires_at: asIso(order.expiresAt),
      paid_at: asIso(order.paidAt),
      failed_at: asIso(order.failedAt),
      refunded_at: asIso(order.refundedAt),
      refunded_amount_idr: order.refundedAmountIdr,
      refund_reason: order.refundReason,
      last_synced_at: asIso(order.lastSyncedAt),
      created_at: asIso(order.createdAt),
      updated_at: asIso(order.updatedAt),
      user: order.user
        ? {
            id: order.user.id,
            handle: order.user.handle,
            username: order.user.username,
            email: order.user.email,
          }
        : null,
      events: order.events.map((event) => ({
        id: event.id,
        order_id: event.orderId,
        event_type: event.eventType,
        status: event.status.toLowerCase(),
        signature_valid: event.signatureValid,
        ip_address: event.ipAddress,
        processed_at: asIso(event.processedAt),
        error_message: event.errorMessage,
        created_at: asIso(event.createdAt),
      })),
    };
  }

  static async listPaymentEvents(
    filters: Pagination &
      DateRange & {
        status?: string;
        order_id?: string;
      } = {}
  ) {
    const { page, limit, skip } = pageArgs(filters);
    const createdAt = dateRangeWhere(filters);
    const where: any = {
      ...(createdAt ? { createdAt } : {}),
      ...(filters.status ? { status: filters.status.toUpperCase() } : {}),
      ...(filters.order_id ? { orderId: filters.order_id } : {}),
    };

    const [total, events] = await Promise.all([
      prisma.paymentEvent.count({ where }),
      prisma.paymentEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          paymentOrderId: true,
          orderId: true,
          eventType: true,
          status: true,
          signatureValid: true,
          processedAt: true,
          errorMessage: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      data: events.map((event) => ({
        id: event.id,
        payment_order_id: event.paymentOrderId,
        order_id: event.orderId,
        event_type: event.eventType,
        status: event.status.toLowerCase(),
        signature_valid: event.signatureValid,
        processed_at: asIso(event.processedAt),
        error_message: event.errorMessage,
        created_at: asIso(event.createdAt),
      })),
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Read-only configuration/posture payload. Environment flags and secrets are
   * intentionally status-only: changing them requires a deploy/secret rotation.
   */
  static async getSystemSettings() {
    const now = new Date();
    const [lastTokenRefresh, lastAudit] = await Promise.all([
      prisma.systemLog.findFirst({
        where: {
          source: 'CANVAS_WORKER',
          message: { contains: 'Token Instagram' },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, message: true, tone: true },
      }),
      prisma.adminAuditLog.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, action: true },
      }),
    ]);

    return {
      generated_at: now.toISOString(),
      app: {
        node_env: ENV.NODE_ENV,
        commit:
          process.env.VERCEL_GIT_COMMIT_SHA ||
          process.env.GIT_COMMIT_SHA ||
          null,
        deployment: process.env.VERCEL_ENV || null,
      },
      environment: {
        payments_enabled: ENV.PAYMENTS_ENABLED,
        base_payouts_enabled: ENV.BASE_PAYOUTS_ENABLED,
        midtrans_is_production: ENV.MIDTRANS_IS_PRODUCTION,
      },
      security: {
        global_rate_limit_per_minute: rateLimitConfig.maxPerMinute,
        global_rate_limit_scope: 'in-memory-per-instance',
        payment_rate_limit_scope: 'postgres-backed',
        reauth_required_for_high_risk: true,
        webhook_signature_verification: true,
        audit_log_enabled: true,
      },
      integrations: {
        midtrans: {
          mode: ENV.MIDTRANS_IS_PRODUCTION ? 'production' : 'sandbox',
          payments_enabled: ENV.PAYMENTS_ENABLED,
          server_key_configured: Boolean(ENV.MIDTRANS_SERVER_KEY),
          client_key_configured: Boolean(ENV.MIDTRANS_CLIENT_KEY),
          merchant_id_configured: Boolean(ENV.MIDTRANS_MERCHANT_ID),
        },
        instagram: {
          app_configured: Boolean(ENV.INSTAGRAM_CLIENT_ID && ENV.INSTAGRAM_CLIENT_SECRET),
          verify_token_configured: Boolean(ENV.INSTAGRAM_VERIFY_TOKEN),
          token_refresh_job: true,
          last_token_refresh_at: asIso(lastTokenRefresh?.createdAt),
          last_token_refresh_status: lastTokenRefresh?.tone ?? null,
        },
        email: {
          resend_configured: Boolean(ENV.RESEND_API_KEY),
          from_configured: Boolean(ENV.EMAIL_FROM),
        },
        payment_reconcile: {
          secret_configured: Boolean(ENV.PAYMENT_RECONCILE_SECRET),
          mode: 'manual',
        },
      },
      jobs: [
        {
          id: 'instagram-token-refresh',
          label: 'Instagram token refresh',
          schedule: 'Boot + setiap 24 jam',
          status: lastTokenRefresh ? 'active' : 'unknown',
          last_run_at: asIso(lastTokenRefresh?.createdAt),
          last_result: lastTokenRefresh?.tone ?? null,
          mode: 'server interval',
        },
        {
          id: 'payment-reconcile',
          label: 'Payment reconcile',
          schedule: 'Manual dengan secret',
          status: ENV.PAYMENT_RECONCILE_SECRET ? 'manual' : 'disabled',
          last_run_at: null,
          last_result: null,
          mode: 'manual',
        },
        {
          id: 'base-revenue-release',
          label: 'Release matured revenue',
          schedule: 'Saat workspace/summary dibuka',
          status: 'lazy',
          last_run_at: null,
          last_result: null,
          mode: 'lazy',
        },
      ],
      last_admin_action_at: asIso(lastAudit?.createdAt),
      last_admin_action: lastAudit?.action ?? null,
    };
  }
}
