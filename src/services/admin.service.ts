import { prisma } from '../config/prisma.js';
import { ENV } from '../config/env.js';
import { rateLimitConfig } from '../middlewares/rateLimit.middleware.js';
import { FessService } from './fess.service.js';
import { InstagramService } from './instagram.service.js';
import { BaseRevenueService } from './base-revenue.service.js';

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
   * Agregasi jumlah fess per periode (hari/bulan/tahun) + distribusi per jam
   * untuk analitik base. Hanya hitung fess dengan status published / approved.
   * Filter base sesuai managedBases user (kecuali Super Admin).
   *
   * `days` (opsional, 1-365) membatasi rentang ke N hari terakhir — dipakai
   * grafik tren harian & distribusi jam. Tanpa `days`, seluruh riwayat dihitung
   * (perilaku lama tetap kompatibel).
   *
   * Pengelompokan tanggal/jam memakai zona Asia/Jakarta supaya angka yang
   * dilihat admin sesuai waktu lokal (kolom DateTime disimpan Prisma dalam UTC).
   */
  static async getFessAnalytics(
    currentUser: { id: string; role: string; managedBases?: string[] },
    params: { range?: string; baseHandle?: string; days?: number | string }
  ) {
    const isSuperAdmin = currentUser.role === 'Super Admin';
    const range = params.range === 'month' ? 'month' : params.range === 'year' ? 'year' : 'day';

    const requestedDays = Number(params.days);
    const days =
      range === 'day' && Number.isFinite(requestedDays) && requestedDays > 0
        ? Math.min(Math.floor(requestedDays), 365)
        : null;

    /** Tanggal kalender Asia/Jakarta (YYYY-MM-DD) untuk sebuah instant. */
    const jakartaDate = (instant: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(instant);

    const now = new Date();
    const to = jakartaDate(now);
    const from = days ? jakartaDate(new Date(now.getTime() - (days - 1) * 86400000)) : null;
    // Batas bawah = tengah malam Asia/Jakarta pada tanggal `from`.
    const since = from ? new Date(`${from}T00:00:00+07:00`) : null;

    const dateFormat =
      range === 'month' ? 'YYYY-MM' : range === 'year' ? 'YYYY' : 'YYYY-MM-DD';
    // Konversi timestamp UTC tersimpan → waktu dinding Asia/Jakarta.
    const localTimestamp = `("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')`;

    /**
     * Bangun kondisi filter + parameter segar untuk tiap query.
     * `offset` = jumlah placeholder yang sudah dipakai query pemanggil
     * (nomor placeholder tidak boleh dipakai ulang antar query).
     */
    const buildFilters = (offset = 0) => {
      const values: any[] = [];
      let sql = '';
      const placeholder = (value: any) => {
        values.push(value);
        return `$${values.length + offset}`;
      };

      const managedBases = !isSuperAdmin ? currentUser.managedBases || [] : [];
      if (managedBases.length > 0) {
        const placeholders = managedBases.map((base) => placeholder(base)).join(', ');
        sql += ` AND "baseHandle" IN (${placeholders})`;
      }

      if (params.baseHandle) {
        sql += ` AND "baseHandle" = ${placeholder(params.baseHandle)}`;
      }

      if (since) {
        // Parameter Date dikirim Prisma sebagai text → cast eksplisit.
        sql += ` AND "createdAt" >= ${placeholder(since)}::timestamptz`;
      }

      return { sql, values };
    };

    const dailyFilters = buildFilters(1); // $1 dipakai format tanggal
    const rows = await prisma.$queryRawUnsafe<Array<{ period: string; count: number }>>(
      `
        SELECT
          to_char(${localTimestamp}, $1) as period,
          COUNT(*)::int as count
        FROM "Fess"
        WHERE "status" IN ('published', 'approved')
        ${dailyFilters.sql}
        GROUP BY period
        ORDER BY period ASC
      `,
      dateFormat,
      ...dailyFilters.values
    );

    // Distribusi jam pembuatan fess (0-23) pada rentang yang sama.
    const hourFilters = buildFilters();
    const hourRows = await prisma.$queryRawUnsafe<Array<{ hour: number; count: number }>>(
      `
        SELECT
          EXTRACT(HOUR FROM ${localTimestamp})::int as hour,
          COUNT(*)::int as count
        FROM "Fess"
        WHERE "status" IN ('published', 'approved')
        ${hourFilters.sql}
        GROUP BY hour
        ORDER BY hour ASC
      `,
      ...hourFilters.values
    );

    const hourMap = new Map(
      (hourRows || []).map((row) => [Number(row.hour), Number(row.count) || 0])
    );
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hourMap.get(hour) || 0,
    }));

    return {
      range,
      baseHandle: params.baseHandle || null,
      days,
      from,
      to,
      timezone: 'Asia/Jakarta',
      data: rows,
      hours,
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
      // Base Admin hanya boleh membaca antrean base yang ia kelola. Tanpa cek
      // ini, `?base=@base_lain` membuka seluruh fess pending + komentar tenant
      // lain (IDOR lintas-tenant).
      const target = String(baseHandle).replace(/^@/, '').toLowerCase();
      const managesTarget = (currentUser.managedBases || []).some(
        (handle) => String(handle).replace(/^@/, '').toLowerCase() === target
      );

      if (!isSuperAdmin && !managesTarget) {
        const err: any = new Error('Base ini tidak Anda kelola.');
        err.status = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }

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

    const data = pendingFesses.map((f) =>
      FessService.serializeFess(f, null, {
        includeIgError: true,
        canManageInstagram: true,
      })
    );

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
  static async getEngineLogs(options: {
    source?: string;
    tone?: string;
    q?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
    const where: any = {};
    if (options.source) where.source = options.source;
    if (options.tone) where.tone = options.tone;
    if (options.q) {
      where.OR = [
        { message: { contains: options.q, mode: 'insensitive' } },
        { source: { contains: options.q, mode: 'insensitive' } },
      ];
    }

    const [total, logs] = await Promise.all([
      prisma.systemLog.count({ where }),
      prisma.systemLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const data = logs.map((l) => ({
      id: l.id,
      time: new Date(l.createdAt).toLocaleTimeString('id-ID', { hour12: false }),
      created_at: l.createdAt,
      source: l.source,
      message: l.message,
      tone: l.tone as 'ok' | 'info' | 'muted' | 'error',
    }));

    return {
      data,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    };
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
   * Cari koneksi Instagram yang relevan untuk admin:
   * 1. koneksi milik admin sendiri,
   * 2. koneksi level base yang dikelola,
   * 3. koneksi milik kreator base yang dikelola.
   */
  private static async resolveInstagramConnection(currentUser: {
    id: string;
    managedBases?: string[];
  }) {
    const direct = await prisma.platformConnection.findFirst({
      where: {
        userId: currentUser.id,
        platform: 'instagram',
        connected: true,
        accessToken: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (direct) return direct;

    const handles = currentUser.managedBases || [];
    if (handles.length === 0) return null;

    const bases = await prisma.base.findMany({
      where: { handle: { in: handles } },
      select: { id: true, creatorId: true },
    });
    if (bases.length === 0) return null;

    const baseConnection = await prisma.platformConnection.findFirst({
      where: {
        baseId: { in: bases.map((base) => base.id) },
        platform: 'instagram',
        connected: true,
        accessToken: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (baseConnection) return baseConnection;

    const creatorIds = bases
      .map((base) => base.creatorId)
      .filter((id): id is string => Boolean(id));
    if (creatorIds.length === 0) return null;

    return prisma.platformConnection.findFirst({
      where: {
        userId: { in: creatorIds },
        platform: 'instagram',
        connected: true,
        accessToken: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private static instagramAccountInfo(connection: {
    accountHandle: string | null;
    metadata: unknown;
  }) {
    const metadata = (connection.metadata || {}) as Record<string, unknown>;
    return {
      handle: connection.accountHandle || null,
      ig_user_id: typeof metadata.igUserId === 'string' ? metadata.igUserId : null,
      ig_username: typeof metadata.igUsername === 'string' ? metadata.igUsername : null,
      token_expires_at:
        typeof metadata.tokenExpiresAt === 'string' ? metadata.tokenExpiresAt : null,
    };
  }

  private static instagramErrorMessage(error: any): string {
    const metaError = error?.response?.data?.error;
    const code = metaError?.code;
    const text = String(metaError?.message || error?.message || '').trim();

    if (code === 190) {
      return 'Token Instagram kedaluwarsa atau dicabut. Hubungkan ulang akun dari menu Koneksi Medsos.';
    }
    if (code === 10 || code === 200 || /permission|scope|insufficient/i.test(text)) {
      return 'Izin insights Instagram belum aktif. Hubungkan ulang akun Instagram dari menu Koneksi Medsos agar izin instagram_business_manage_insights diberikan.';
    }
    return text || 'Gagal mengambil Instagram Insights.';
  }

  /**
   * Instagram account insights + audiens untuk admin base.
   */
  static async getInstagramInsights(currentUser: { id: string; managedBases?: string[] }) {
    const conn = await this.resolveInstagramConnection(currentUser);

    if (!conn) {
      return {
        connected: false,
        account: null,
        data: null,
        message: 'Akun Instagram belum terhubung. Hubungkan dari menu Koneksi Medsos.',
      };
    }

    const token = conn.accessToken;
    if (!token) {
      return {
        connected: true,
        account: this.instagramAccountInfo(conn),
        data: null,
        message: 'Token akses Instagram tidak tersedia.',
      };
    }

    try {
      const data = await InstagramService.getAccountInsights(token);
      return {
        connected: true,
        account: this.instagramAccountInfo(conn),
        data,
      };
    } catch (error: any) {
      return {
        connected: true,
        account: this.instagramAccountInfo(conn),
        data: null,
        message: this.instagramErrorMessage(error),
      };
    }
  }

  /**
   * Insights konten Instagram terbaru (media-level).
   */
  static async getInstagramMediaInsights(currentUser: {
    id: string;
    managedBases?: string[];
  }) {
    const conn = await this.resolveInstagramConnection(currentUser);

    if (!conn) {
      return {
        connected: false,
        account: null,
        data: null,
        message: 'Akun Instagram belum terhubung. Hubungkan dari menu Koneksi Medsos.',
      };
    }

    const token = conn.accessToken;
    if (!token) {
      return {
        connected: true,
        account: this.instagramAccountInfo(conn),
        data: null,
        message: 'Token akses Instagram tidak tersedia.',
      };
    }

    try {
      const data = await InstagramService.getRecentMediaInsights(token, 6);
      return {
        connected: true,
        account: this.instagramAccountInfo(conn),
        data,
      };
    } catch (error: any) {
      return {
        connected: true,
        account: this.instagramAccountInfo(conn),
        data: null,
        message: this.instagramErrorMessage(error),
      };
    }
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
   * Get treasury balance. Treasury is IDR revenue owned by a Base and is
   * deliberately separate from the user's CTF wallet (CTF is never cashable).
   */
  static async getTreasury(currentUser: {
    id: string;
    role: string;
    managedBases?: string[];
  }) {
    // Pastikan revenue yang sudah melewati hold muncul sebagai available
    // sebelum angka treasury dihitung.
    await BaseRevenueService.releaseMatured();

    const isSuperAdmin = currentUser.role === 'Super Admin';
    const managedHandles = currentUser.managedBases || [];
    const bases = await prisma.base.findMany({
      where: isSuperAdmin
        ? {}
        : {
            OR: [
              { creatorId: currentUser.id },
              ...(managedHandles.length > 0 ? [{ handle: { in: managedHandles } }] : []),
            ],
          },
      select: {
        id: true,
        handle: true,
        name: true,
        revenueWallet: {
          select: {
            pendingIdr: true,
            availableIdr: true,
            reservedIdr: true,
            lifetimeIdr: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const totals = bases.reduce(
      (acc, base) => {
        acc.pendingIdr += base.revenueWallet?.pendingIdr ?? 0;
        acc.availableIdr += base.revenueWallet?.availableIdr ?? 0;
        acc.reservedIdr += base.revenueWallet?.reservedIdr ?? 0;
        acc.lifetimeIdr += base.revenueWallet?.lifetimeIdr ?? 0;
        return acc;
      },
      { pendingIdr: 0, availableIdr: 0, reservedIdr: 0, lifetimeIdr: 0 }
    );

    return {
      // `balance` is kept for the existing treasury UI; it is now IDR, not CTF.
      balance: totals.availableIdr,
      available_idr: totals.availableIdr,
      pending_idr: totals.pendingIdr,
      reserved_idr: totals.reservedIdr,
      lifetime_idr: totals.lifetimeIdr,
      currency: 'IDR',
      bases: bases.map((base) => ({
        id: base.id,
        handle: base.handle,
        name: base.name,
        available_idr: base.revenueWallet?.availableIdr ?? 0,
        pending_idr: base.revenueWallet?.pendingIdr ?? 0,
        reserved_idr: base.revenueWallet?.reservedIdr ?? 0,
        lifetime_idr: base.revenueWallet?.lifetimeIdr ?? 0,
      })),
    };
  }

  /**
   * Request treasury payout. The dedicated IDR payout workflow is built in
   * Phase 5; until then this endpoint must never touch CTF or legacy balance.
   */
  static async requestPayout(
    _currentUser: { id: string },
    _amount: number,
    _destination = 'wallet'
  ) {
    if (!ENV.BASE_PAYOUTS_ENABLED) {
      const err: any = new Error('Payout base sedang dinonaktifkan');
      err.status = 503;
      err.code = 'PAYOUTS_DISABLED';
      throw err;
    }

    const err: any = new Error('Workflow payout IDR belum diaktifkan');
    err.status = 501;
    err.code = 'PAYOUTS_NOT_READY';
    throw err;
  }
}
