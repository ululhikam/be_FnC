import { prisma } from '../config/prisma.js';
import { ENV } from '../config/env.js';
import { getOrSet, invalidateCache } from '../utils/cache.util.js';
import { AdminSecurityService } from './admin-security.service.js';
import { MidtransService } from './midtrans.service.js';

/**
 * Mode gateway pembayaran Midtrans.
 * ---------------------------------------------------------------------------
 * - `core_api` (default): transaksi dibuat lewat `POST /v2/charge`, instruksi
 *   VA/QR/deeplink ditampilkan di dalam aplikasi.
 * - `snap`: transaksi dibuat lewat `POST /snap/v1/transactions`, lalu pengguna
 *   membayar di popup Snap.
 *
 * Setting disimpan di `SystemSetting` supaya bisa diubah Super Admin tanpa
 * deploy. Setiap order menyimpan `gatewayMode` sebagai snapshot agar pergantian
 * mode tidak mengubah tampilan order lama.
 */

export const PAYMENT_GATEWAY_MODES = ['core_api', 'snap'] as const;
export type PaymentGatewayMode = (typeof PAYMENT_GATEWAY_MODES)[number];

export const PAYMENT_GATEWAY_SETTING_KEY = 'payment_gateway';

const CACHE_KEY = 'payment-gateway:config';
const CACHE_TTL_MS = 20_000;

export type PaymentGatewayActor = { id: string; role?: string | null };
export type PaymentGatewayRequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type PaymentGatewayPublicConfig = {
  mode: PaymentGatewayMode;
  snap_client_key: string | null;
  snap_script_url: string;
  /** Popup bisa dipakai bila Client Key tersedia; jika tidak, redirect dipakai. */
  snap_popup_ready: boolean;
};

function fail(status: number, code: string, message: string): never {
  const error: any = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function normalizeMode(value: unknown): PaymentGatewayMode | null {
  return PAYMENT_GATEWAY_MODES.includes(value as PaymentGatewayMode)
    ? (value as PaymentGatewayMode)
    : null;
}

function modeFromSetting(value: unknown): PaymentGatewayMode {
  if (typeof value === 'string') return normalizeMode(value) ?? 'core_api';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return normalizeMode((value as Record<string, unknown>).mode) ?? 'core_api';
  }
  return 'core_api';
}

function assertReason(reason: string | null | undefined) {
  const clean = String(reason ?? '').trim();
  if (clean.length < 5) {
    fail(422, 'REASON_REQUIRED', 'Alasan perubahan mode gateway wajib diisi minimal 5 karakter');
  }
  return clean;
}

function buildPublicConfig(mode: PaymentGatewayMode): PaymentGatewayPublicConfig {
  const clientKey = ENV.MIDTRANS_CLIENT_KEY.trim();
  return {
    mode,
    snap_client_key: clientKey || null,
    snap_script_url: MidtransService.snapScriptUrl(),
    snap_popup_ready: Boolean(clientKey && ENV.MIDTRANS_SERVER_KEY),
  };
}

async function readSetting() {
  try {
    return await prisma.systemSetting.findUnique({
      where: { key: PAYMENT_GATEWAY_SETTING_KEY },
      select: {
        value: true,
        updatedById: true,
        updatedAt: true,
      },
    });
  } catch {
    // Setting yang belum ada / tabel belum siap tidak boleh mematikan top-up.
    // Default ke Core API, mode yang sudah terbukti dipakai production.
    return null;
  }
}

export class PaymentGatewayService {
  /** Mode aktif. `fresh` dipakai saat membuat order agar toggle langsung berlaku. */
  static async getMode(options: { fresh?: boolean } = {}): Promise<PaymentGatewayMode> {
    if (options.fresh) {
      const setting = await readSetting();
      return modeFromSetting(setting?.value);
    }
    const config = await this.getConfig();
    return config.mode;
  }

  static async getConfig(options: { fresh?: boolean } = {}): Promise<PaymentGatewayPublicConfig> {
    if (options.fresh) {
      const setting = await readSetting();
      return buildPublicConfig(modeFromSetting(setting?.value));
    }

    return getOrSet(CACHE_KEY, CACHE_TTL_MS, async () => {
      const setting = await readSetting();
      return buildPublicConfig(modeFromSetting(setting?.value));
    });
  }

  /** Payload konsol Super Admin (status + opsi + metadata perubahan). */
  static async getAdminView() {
    const [setting, config] = await Promise.all([readSetting(), this.getConfig({ fresh: true })]);

    return {
      mode: config.mode,
      source: setting ? ('database' as const) : ('default' as const),
      options: [
        {
          value: 'core_api' as const,
          label: 'Core API',
          description:
            'Instruksi VA, QRIS, dan e-wallet ditampilkan langsung di halaman top-up. Flow lama yang sudah terbukti.',
        },
        {
          value: 'snap' as const,
          label: 'Snap',
          description:
            'Pembayaran dibuka di popup Midtrans. Metode yang dipilih pengguna tetap dibatasi lewat enabled_payments.',
        },
      ],
      snap_client_key_configured: Boolean(ENV.MIDTRANS_CLIENT_KEY),
      snap_script_url: config.snap_script_url,
      snap_popup_ready: config.snap_popup_ready,
      midtrans_is_production: ENV.MIDTRANS_IS_PRODUCTION,
      updated_at: setting?.updatedAt ? setting.updatedAt.toISOString() : null,
      updated_by_id: setting?.updatedById ?? null,
    };
  }

  static async setMode(
    currentUser: PaymentGatewayActor,
    input: { mode: string; reason: string; password?: string | null },
    meta: PaymentGatewayRequestMeta = {}
  ) {
    if (currentUser.role !== 'Super Admin') {
      fail(403, 'FORBIDDEN', 'Hanya Super Admin yang dapat mengubah mode gateway pembayaran');
    }
    await AdminSecurityService.assertReauth(currentUser.id, input.password);

    const mode = normalizeMode(input.mode);
    if (!mode) {
      fail(422, 'INVALID_GATEWAY_MODE', 'Mode gateway harus core_api atau snap');
    }
    const reason = assertReason(input.reason);

    const previousSetting = await readSetting();
    const previousMode = modeFromSetting(previousSetting?.value);

    await prisma.systemSetting.upsert({
      where: { key: PAYMENT_GATEWAY_SETTING_KEY },
      create: {
        key: PAYMENT_GATEWAY_SETTING_KEY,
        value: { mode },
        description: 'Mode gateway pembayaran Midtrans (core_api atau snap)',
        updatedById: currentUser.id,
      },
      update: {
        value: { mode },
        updatedById: currentUser.id,
      },
    });

    await AdminSecurityService.writeAudit({
      actorId: currentUser.id,
      action: 'PAYMENT_GATEWAY_MODE_CHANGED',
      targetType: 'SystemSetting',
      targetId: PAYMENT_GATEWAY_SETTING_KEY,
      reason,
      metadata: {
        previous_mode: previousMode,
        new_mode: mode,
        snap_popup_ready: buildPublicConfig(mode).snap_popup_ready,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    invalidateCache(CACHE_KEY);

    await AdminSecurityService.writeAlert(
      'PAYOUT',
      `Super Admin ${currentUser.id} mengubah mode gateway pembayaran: ${previousMode} → ${mode}. Alasan: ${reason}`,
      'info'
    );

    return this.getAdminView();
  }
}
