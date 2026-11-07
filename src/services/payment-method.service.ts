import { prisma } from '../config/prisma.js';
import { getOrSet, invalidateCache } from '../utils/cache.util.js';
import { AdminSecurityService } from './admin-security.service.js';
import {
  PAYMENT_EXPIRY_MINUTES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_CODES,
  offeredPaymentMethods,
} from '../constants/payments.js';

/**
 * Metode pembayaran yang ditawarkan ke pengguna.
 * ---------------------------------------------------------------------------
 * Super Admin dapat menyembunyikan metode tertentu tanpa deploy. Setting
 * disimpan di `SystemSetting` (key `payment_methods`):
 *   - `disabled` = daftar kode yang **dinonaktifkan**. Default (belum ada
 *     setting) = semua metode tampil, sama seperti dulu; metode baru di katalog
 *     otomatis tampil.
 *   - `order` = urutan tampil pilihan Super Admin. Kode yang tidak disebut
 *     diletakkan di belakang mengikuti urutan katalog, sehingga metode baru
 *     tetap muncul walau admin belum mengurutkannya.
 *
 * Yang diatur hanyalah tampilan/penawaran. Order lama tetap dibaca memakai
 * katalog penuh (`findPaymentMethod`) sehingga instruksi pembayarannya tidak
 * hilang saat metodenya dinonaktifkan kemudian.
 */

export const PAYMENT_METHODS_SETTING_KEY = 'payment_methods';

const CACHE_KEY = 'payment-methods:config';
const CACHE_TTL_MS = 20_000;

const CATALOG_CODES: readonly string[] = PAYMENT_METHOD_CODES;

export type PaymentMethodActor = { id: string; role?: string | null };
export type PaymentMethodRequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type PaymentMethodAdminRow = {
  code: string;
  label: string;
  group: string;
  description: string;
  enabled: boolean;
  /** Nominal paket minimum, `null` bila metode ini tidak punya batas. */
  min_amount_idr: number | null;
};

export type PaymentMethodAdminView = {
  source: 'database' | 'default';
  methods: PaymentMethodAdminRow[];
  /** Urutan tampil yang berlaku (kode, dari atas ke bawah). */
  order: string[];
  enabled_count: number;
  disabled_count: number;
  /** Batas waktu pembayaran yang berlaku (konstanta, bukan setting). */
  expiry_minutes: number;
  updated_at: string | null;
  updated_by_id: string | null;
};

type PaymentMethodConfig = {
  disabled: string[];
  order: string[];
};

function fail(status: number, code: string, message: string): never {
  const error: any = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function isCatalogCode(value: unknown): boolean {
  return typeof value === 'string' && CATALOG_CODES.includes(value);
}

/**
 * Normalisasi isi setting menjadi daftar kode katalog yang valid. Bentuk yang
 * didukung: `{ disabled: [...] }` (format utama) atau array langsung
 * (toleransi untuk data yang diisi manual).
 */
function normalizeDisabled(value: unknown): string[] {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).disabled
      : value;

  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (isCatalogCode(item)) seen.add(item as string);
  }
  // Setting rusak yang mematikan SEMUA metode diabaikan: lebih baik semua
  // tampil daripada top-up mati total karena satu baris data yang salah.
  if (seen.size >= CATALOG_CODES.length) return [];
  return [...seen];
}

/**
 * Normalisasi urutan tampil. Kode asing dibuang, duplikat diabaikan, dan kode
 * katalog yang belum disebut ditambahkan di belakang agar daftar selalu
 * lengkap (tidak ada metode yang hilang hanya karena urutan belum diisi).
 */
function normalizeOrder(value: unknown): string[] {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).order
      : value;

  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isCatalogCode(item)) seen.add(item as string);
    }
  }
  for (const code of CATALOG_CODES) {
    if (!seen.has(code)) seen.add(code);
  }
  return [...seen];
}

async function readSetting() {
  try {
    return await prisma.systemSetting.findUnique({
      where: { key: PAYMENT_METHODS_SETTING_KEY },
      select: { value: true, updatedById: true, updatedAt: true },
    });
  } catch {
    // Setting yang belum ada / tabel belum siap tidak boleh mematikan top-up.
    return null;
  }
}

export class PaymentMethodService {
  /** Konfigurasi metode (nonaktif + urutan). `fresh` dipakai saat membuat order. */
  static async getConfig(options: { fresh?: boolean } = {}): Promise<PaymentMethodConfig> {
    const read = async () => {
      const setting = await readSetting();
      return {
        disabled: normalizeDisabled(setting?.value),
        order: normalizeOrder(setting?.value),
      };
    };
    if (options.fresh) return read();
    return getOrSet(CACHE_KEY, CACHE_TTL_MS, read);
  }

  /** Kode yang dinonaktifkan. `fresh` dipakai saat membuat order. */
  static async getDisabledCodes(options: { fresh?: boolean } = {}): Promise<string[]> {
    return (await this.getConfig(options)).disabled;
  }

  /** Urutan tampil metode dari atas ke bawah (seluruh katalog). */
  static async getMethodOrder(options: { fresh?: boolean } = {}): Promise<string[]> {
    return (await this.getConfig(options)).order;
  }

  /** Metode yang boleh dipilih pengguna pada order baru (urutan pilihan admin). */
  static async getEnabledMethods(options: { fresh?: boolean } = {}) {
    const { disabled, order } = await this.getConfig(options);
    return offeredPaymentMethods(disabled, order);
  }

  /**
   * Apakah metode ini boleh dipakai untuk order baru. Kode di luar katalog
   * selalu `false`. `fresh` mencegah cache 20 detik menahan perubahan toggle.
   */
  static async isEnabled(code: string, options: { fresh?: boolean } = {}): Promise<boolean> {
    if (!isCatalogCode(code)) return false;
    const disabled = await this.getDisabledCodes(options);
    return !disabled.includes(code);
  }

  /** Payload konsol Super Admin: seluruh katalog sesuai urutan, plus status aktif. */
  static async getAdminView(): Promise<PaymentMethodAdminView> {
    const [setting, { disabled, order }] = await Promise.all([
      readSetting(),
      this.getConfig({ fresh: true }),
    ]);
    const hidden = new Set(disabled);
    const byCode = new Map<string, (typeof PAYMENT_METHODS)[number]>(
      PAYMENT_METHODS.map((method) => [method.code, method])
    );
    const methods: PaymentMethodAdminRow[] = order.flatMap((code) => {
      const method = byCode.get(code);
      if (!method) return [];
      return [
        {
          code: method.code,
          label: method.label,
          group: method.group,
          description: method.description,
          enabled: !hidden.has(method.code),
          min_amount_idr: method.minAmountIdr ?? null,
        },
      ];
    });

    return {
      source: setting ? ('database' as const) : ('default' as const),
      methods,
      order,
      enabled_count: methods.filter((method) => method.enabled).length,
      disabled_count: methods.filter((method) => !method.enabled).length,
      expiry_minutes: PAYMENT_EXPIRY_MINUTES,
      updated_at: setting?.updatedAt ? setting.updatedAt.toISOString() : null,
      updated_by_id: setting?.updatedById ?? null,
    };
  }

  /**
   * Simpan daftar metode aktif dan urutan tampilnya. `enabled` adalah daftar
   * kode yang dicentang Super Admin; sisanya disimpan sebagai daftar nonaktif.
   * `order` opsional: bila tidak dikirim, urutan sebelumnya dipertahankan.
   */
  static async setEnabled(
    currentUser: PaymentMethodActor,
    input: {
      enabled: string[];
      order?: string[];
      reason: string;
      password?: string | null;
    },
    meta: PaymentMethodRequestMeta = {}
  ) {
    if (currentUser.role !== 'Super Admin') {
      fail(403, 'FORBIDDEN', 'Hanya Super Admin yang dapat mengubah metode pembayaran');
    }
    await AdminSecurityService.assertReauth(currentUser.id, input.password);

    if (!Array.isArray(input.enabled)) {
      fail(422, 'INVALID_PAYMENT_METHODS', 'Daftar metode pembayaran tidak valid');
    }
    const enabled = new Set<string>();
    for (const code of input.enabled) {
      if (!isCatalogCode(code)) {
        fail(422, 'INVALID_PAYMENT_METHODS', `Metode pembayaran tidak dikenal: ${String(code)}`);
      }
      enabled.add(code);
    }
    if (!enabled.size) {
      fail(422, 'PAYMENT_METHODS_EMPTY', 'Minimal satu metode pembayaran harus tetap aktif');
    }

    const previousSetting = await readSetting();
    const previousDisabled = normalizeDisabled(previousSetting?.value);
    const previousOrder = normalizeOrder(previousSetting?.value);
    const previousEnabled = offeredPaymentMethods(previousDisabled, previousOrder).map(
      (method) => method.code
    );

    // Urutan divalidasi terhadap katalog, bukan terhadap daftar aktif: admin
    // boleh mengurutkan metode yang sedang nonaktif agar tidak hilang saat
    // diaktifkan lagi.
    let order = previousOrder;
    if (input.order !== undefined) {
      if (!Array.isArray(input.order)) {
        fail(422, 'INVALID_PAYMENT_METHOD_ORDER', 'Urutan metode pembayaran tidak valid');
      }
      for (const code of input.order) {
        if (!isCatalogCode(code)) {
          fail(
            422,
            'INVALID_PAYMENT_METHOD_ORDER',
            `Metode pembayaran tidak dikenal pada urutan: ${String(code)}`
          );
        }
      }
      order = normalizeOrder(input.order);
    }

    const cleanReason = String(input.reason ?? '').trim();
    if (cleanReason.length < 5) {
      fail(422, 'REASON_REQUIRED', 'Alasan perubahan metode wajib diisi minimal 5 karakter');
    }

    // Disimpan sebagai daftar nonaktif agar metode baru di katalog otomatis
    // tampil tanpa perlu diaktifkan manual.
    const disabled = CATALOG_CODES.filter((code) => !enabled.has(code));
    const value = { disabled, order };

    await prisma.systemSetting.upsert({
      where: { key: PAYMENT_METHODS_SETTING_KEY },
      create: {
        key: PAYMENT_METHODS_SETTING_KEY,
        value,
        description: 'Metode pembayaran yang disembunyikan dari pengguna dan urutan tampilnya',
        updatedById: currentUser.id,
      },
      update: {
        value,
        updatedById: currentUser.id,
      },
    });

    await AdminSecurityService.writeAudit({
      actorId: currentUser.id,
      action: 'PAYMENT_METHODS_CHANGED',
      targetType: 'SystemSetting',
      targetId: PAYMENT_METHODS_SETTING_KEY,
      reason: cleanReason,
      metadata: {
        previous_enabled: previousEnabled,
        enabled: [...enabled],
        disabled,
        previous_order: previousOrder,
        order,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    invalidateCache(CACHE_KEY);

    const labels = PAYMENT_METHODS.filter((method) => enabled.has(method.code))
      .map((method) => method.label)
      .join(', ');
    await AdminSecurityService.writeAlert(
      'PAYOUT',
      `Super Admin ${currentUser.id} mengubah metode pembayaran. Aktif: ${labels}. Alasan: ${cleanReason}`,
      'info'
    );

    return this.getAdminView();
  }
}