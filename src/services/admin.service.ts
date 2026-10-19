import { prisma } from '../config/prisma.js';
import { rateLimitConfig } from '../middlewares/rateLimit.middleware.js';
import { FessService } from './fess.service.js';

export class AdminService {
  /**
   * Get stats for admin dashboard "Ringkasan"
   */
  static async getStats(currentUser: { id: string; role: string; managedBases?: string[] }) {
    const isSuperAdmin = currentUser.role === 'Super Admin';
    const baseFilter =
      !isSuperAdmin && currentUser.managedBases && currentUser.managedBases.length > 0
        ? { baseHandle: { in: currentUser.managedBases } }
        : {};

    const [
      total_fesses,
      published,
      pending,
      rejected,
      reported,
      total_votes,
      total_bases,
      total_users,
    ] = await Promise.all([
      prisma.fess.count({ where: baseFilter }),
      prisma.fess.count({ where: { ...baseFilter, status: { in: ['published', 'approved'] } } }),
      prisma.fess.count({ where: { ...baseFilter, status: 'pending' } }),
      prisma.fess.count({ where: { ...baseFilter, status: 'rejected' } }),
      prisma.fess.count({
        where: { ...baseFilter, reports: { some: { status: 'pending' } } },
      }),
      prisma.vote.count(),
      prisma.base.count(),
      prisma.user.count(),
    ]);

    return {
      total_fesses,
      published,
      pending,
      rejected,
      reported,
      total_votes,
      total_bases,
      total_users,
    };
  }

  /**
   * Get pending moderation queue
   */
  static async getModerationQueue(
    currentUser: { id: string; role: string; managedBases?: string[] },
    baseHandle?: string,
    page = 1,
    limit = 20
  ) {
    const isSuperAdmin = currentUser.role === 'Super Admin';
    const skip = (page - 1) * limit;

    const where: any = {
      status: 'pending',
    };

    if (baseHandle) {
      where.baseHandle = baseHandle;
    } else if (!isSuperAdmin && currentUser.managedBases && currentUser.managedBases.length > 0) {
      where.baseHandle = { in: currentUser.managedBases };
    }

    const [total, pendingFesses] = await Promise.all([
      prisma.fess.count({ where }),
      prisma.fess.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { comments: true },
      }),
    ]);

    const data = pendingFesses.map((f) => FessService.serializeFess(f, null));

    return {
      data,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Get Super Admin system health & monitoring stats
   */
  static async getSystemHealth() {
    const [global_confessions_sent, active_bases, banned_actors] = await Promise.all([
      prisma.fess.count(),
      prisma.base.count(),
      prisma.user.count({ where: { isBanned: true } }),
    ]);

    // Read security settings from DB or memory
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'security_controls' },
    });

    const config = (setting?.value as any) || {
      ai_filter_active: true,
      canvas_worker_running: true,
      rate_limit_per_ip: rateLimitConfig.maxPerMinute,
    };

    return {
      status: 'ok',
      global_confessions_sent,
      active_bases,
      system_load_percent: 24.8,
      banned_actors,
      rate_limit_per_ip: config.rate_limit_per_ip || rateLimitConfig.maxPerMinute,
      ai_filter_active: config.ai_filter_active ?? true,
      canvas_worker_running: config.canvas_worker_running ?? true,
      redis_memory_mb: 42.6,
      redis_max_memory_mb: 256.0,
    };
  }

  /**
   * Update security controls
   */
  static async updateSecurityControls(data: {
    rate_limit_per_ip?: number;
    ai_filter_active?: boolean;
    canvas_worker_running?: boolean;
  }) {
    if (data.rate_limit_per_ip) {
      rateLimitConfig.maxPerMinute = data.rate_limit_per_ip;
    }

    await prisma.systemSetting.upsert({
      where: { key: 'security_controls' },
      create: {
        key: 'security_controls',
        value: data as any,
      },
      update: {
        value: data as any,
      },
    });

    await prisma.systemLog.create({
      data: {
        source: 'RATE_LIMITER',
        message: `Security controls updated: rate_limit=${data.rate_limit_per_ip || rateLimitConfig.maxPerMinute}/min`,
        tone: 'info',
      },
    });

    return this.getSystemHealth();
  }

  /**
   * Get real-time engine logs
   */
  static async getEngineLogs(source?: string, limit = 50) {
    const where: any = {};
    if (source) {
      where.source = source;
    }

    const logs = await prisma.systemLog.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    const data = logs.map((l) => ({
      id: l.id,
      time: new Date(l.createdAt).toLocaleTimeString('id-ID', { hour12: false }),
      source: l.source,
      message: l.message,
      tone: l.tone as 'ok' | 'info' | 'muted' | 'error',
    }));

    return { data };
  }

  /**
   * Ban user
   */
  static async banUser(userId: string, reason: string, durationHours = 0) {
    const banExpiresAt =
      durationHours > 0 ? new Date(Date.now() + durationHours * 3600 * 1000) : null;

    await prisma.user.update({
      where: { id: userId },
      data: {
        isBanned: true,
        banReason: reason,
        banExpiresAt,
      },
    });

    await prisma.systemLog.create({
      data: {
        source: 'AI_FILTER',
        message: `User ${userId} telah diblokir. Alasan: ${reason} (${durationHours === 0 ? 'Permanen' : `${durationHours} jam`})`,
        tone: 'error',
      },
    });

    return { ok: true, message: `User ${userId} berhasil diblokir.` };
  }

  /**
   * Get social media platform connections
   */
  static async getPlatformConnections(currentUser: { id: string }) {
    const connections = await prisma.platformConnection.findMany({
      where: { userId: currentUser.id },
    });

    const connectionMap = new Map(connections.map((c) => [c.platform, c]));

    const platforms: ('twitter' | 'instagram' | 'telegram')[] = ['instagram', 'twitter', 'telegram'];

    const data = platforms.map((platform) => {
      const conn = connectionMap.get(platform);
      const metadata = (conn?.metadata || {}) as Record<string, unknown>;
      return {
        id: platform,
        name:
          platform === 'instagram'
            ? 'Instagram Graph API (Auto-Post Feed & Reels)'
            : platform === 'twitter'
            ? 'Twitter / X Autobase Bot'
            : 'Telegram Channel Broadcast',
        status: conn?.connected ? 'connected' : 'idle',
        connected: conn?.connected || false,
        account_handle: conn?.accountHandle || '',
        // Info masa berlaku token (khusus Instagram — dari metadata koneksi).
        token_expires_at:
          typeof metadata.tokenExpiresAt === 'string' ? metadata.tokenExpiresAt : null,
      };
    });

    return { data };
  }

  /**
   * Toggle platform connection
   */
  static async togglePlatformConnection(
    currentUser: { id: string },
    platform: string,
    action = 'connect',
    accountHandle = ''
  ) {
    const connected = action === 'connect';

    const conn = await prisma.platformConnection.upsert({
      where: {
        userId_platform: {
          userId: currentUser.id,
          platform,
        },
      },
      create: {
        userId: currentUser.id,
        platform,
        name:
          platform === 'instagram'
            ? 'Instagram Graph API (Auto-Post Feed & Reels)'
            : platform === 'twitter'
            ? 'Twitter / X Autobase Bot'
            : 'Telegram Channel Broadcast',
        status: connected ? 'connected' : 'idle',
        connected,
        accountHandle,
      },
      update: {
        status: connected ? 'connected' : 'idle',
        connected,
        ...(accountHandle ? { accountHandle } : {}),
        // Putuskan koneksi = access token benar-benar dihapus dari server
        // (sesuai Kebijakan Privasi & syarat review Meta).
        ...(connected ? {} : { accessToken: null }),
      },
    });

    return {
      id: conn.platform,
      name: conn.name,
      status: conn.status,
      connected: conn.connected,
      account_handle: conn.accountHandle || '',
    };
  }

  /**
   * Get treasury balance
   */
  static async getTreasury(currentUser: { id: string }) {
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { balance: true, revenue: true },
    });

    return {
      balance: user?.balance ?? 0,
      revenue: user?.revenue ?? 0,
      currency: '$CLUB',
    };
  }

  /**
   * Request treasury payout
   */
  static async requestPayout(currentUser: { id: string }, amount: number, destination = 'wallet') {
    const user = await prisma.user.findUnique({ where: { id: currentUser.id } });

    if (!user || amount <= 0 || user.balance < amount) {
      const err: any = new Error('Saldo treasury tidak mencukupi untuk melakukan penarikan');
      err.status = 400;
      err.code = 'INSUFFICIENT_BALANCE';
      throw err;
    }

    await prisma.$transaction([
      prisma.payout.create({
        data: {
          userId: currentUser.id,
          amount,
          destination,
          status: 'pending',
        },
      }),
      prisma.user.update({
        where: { id: currentUser.id },
        data: { balance: { decrement: amount } },
      }),
    ]);

    return { ok: true, message: `Permintaan payout sebesar ${amount} $CLUB berhasil diajukan.` };
  }
}
