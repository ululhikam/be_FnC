import { prisma } from '../config/prisma.js';
import {
  PAYMENT_PACKAGES,
  sanitizePackageCode,
  type PaymentPackage,
} from '../constants/payments.js';
import { getOrSet, invalidateCache } from '../utils/cache.util.js';
import { AdminSecurityService } from './admin-security.service.js';

/**
 * Katalog paket top-up CTF.
 * ---------------------------------------------------------------------------
 * - Sumber kebenaran: tabel `PaymentPackage` (bisa diubah Super Admin).
 * - `PAYMENT_PACKAGES` di constants/payments.ts hanya dipakai sebagai fallback
 *   saat tabel belum ada (deploy sebelum migrasi), supaya endpoint publik tidak
 *   ikut mati.
 * - `PaymentOrder` menyimpan snapshot nominal, jadi mengubah paket tidak
 *   mengubah order yang sudah dibuat.
 * - Semua mutasi menginvalidasi cache `payment-packages:` agar katalog publik
 *   langsung berubah.
 */

const CACHE_PREFIX = 'payment-packages:';
const CACHE_TTL_MS = 20_000;

export type PaymentPackageActor = { id: string; role?: string | null };
export type RequestMeta = { ipAddress?: string | null; userAgent?: string | null };

export type AdminPaymentPackageInput = {
  name: string;
  amountIdr: number;
  ctfAmount: number;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  reason: string;
  password?: string | null;
};

export type CreatePaymentPackageInput = AdminPaymentPackageInput & { code: string };

/**
 * Harga massal: satu harga dasar per CTF untuk seluruh katalog, ditambah bonus
 * per paket (dalam CTF).
 *
 * Nominal rupiah tiap paket TIDAK diubah — hanya jumlah CTF yang dihitung
 * ulang — sehingga admin cukup mengisi dua hal untuk menyesuaikan semua paket
 * sekaligus, tanpa menyunting paket satu per satu.
 */
export type BulkPriceInput = {
  pricePerCtf: number;
  /** Bonus CTF per paket. Wajib lengkap untuk semua paket yang ada. */
  packages: Array<{ code: string; bonusCtf: number }>;
  reason: string;
  password?: string | null;
};

export type BulkPriceRow = {
  code: string;
  name: string;
  amountIdr: number;
  /** `floor(amountIdr / pricePerCtf)` — bagian yang dibayar murni. */
  baseCtf: number;
  bonusCtf: number;
  ctfAmount: number;
  /** Nilai sebelum perubahan, untuk pratinjau "lama → baru". */
  previousCtfAmount: number;
  changed: boolean;
};

export type PaymentPackageView = {
  code: string;
  name: string;
  amount_idr: number;
  ctf_amount: number;
  description: string;
  sort_order: number;
  is_active: boolean;
  updated_at: string | null;
  updated_by_id: string | null;
};

type Row = {
  code: string;
  name: string;
  amountIdr: number;
  ctfAmount: number;
  description: string;
  sortOrder: number;
  isActive: boolean;
  updatedById: string | null;
  updatedAt: Date;
};

function fail(status: number, code: string, message: string): never {
  const error: any = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

/** Tabel belum ada karena migrasi belum dijalankan (deploy lebih dulu dari DB). */
function isMissingTable(error: unknown) {
  return (error as any)?.code === 'P2021';
}

function toView(row: Row): PaymentPackageView {
  return {
    code: row.code,
    name: row.name,
    amount_idr: row.amountIdr,
    ctf_amount: row.ctfAmount,
    description: row.description,
    sort_order: row.sortOrder,
    is_active: row.isActive,
    updated_at: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
    updated_by_id: row.updatedById,
  };
}

function toPublic(row: Row): PaymentPackage {
  return {
    code: row.code,
    name: row.name,
    amountIdr: row.amountIdr,
    ctfAmount: row.ctfAmount,
    description: row.description,
  };
}

function assertReason(reason: string | null | undefined, label: string) {
  const clean = String(reason ?? '').trim();
  if (clean.length < 5) {
    fail(422, 'REASON_REQUIRED', `Alasan ${label} wajib diisi minimal 5 karakter`);
  }
  return clean;
}

const select = {
  code: true,
  name: true,
  amountIdr: true,
  ctfAmount: true,
  description: true,
  sortOrder: true,
  isActive: true,
  updatedById: true,
  updatedAt: true,
} as const;

export class PaymentPackageService {
  /** Katalog publik (hanya yang aktif), di-cache 20 detik. */
  static async listActive(): Promise<PaymentPackage[]> {
    return getOrSet(`${CACHE_PREFIX}active`, CACHE_TTL_MS, async () => {
      try {
        const rows = await prisma.paymentPackage.findMany({
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { amountIdr: 'asc' }],
          select,
        });
        // Tabel kosong = Super Admin menonaktifkan semua paket. Kembalikan
        // daftar kosong (bukan fallback konstanta) agar keputusan admin dihormati.
        return rows.map(toPublic);
      } catch (error) {
        if (isMissingTable(error)) return PAYMENT_PACKAGES;
        throw error;
      }
    });
  }

  /**
   * Paket yang dipakai saat membuat order. Dibaca langsung dari DB (tanpa
   * cache) supaya paket yang baru dinonaktifkan tidak bisa dibeli.
   */
  static async findForOrder(code: string): Promise<PaymentPackage | null> {
    const cleanCode = sanitizePackageCode(code);
    if (!cleanCode) return null;

    let row: Row | null;
    try {
      row = await prisma.paymentPackage.findUnique({ where: { code: cleanCode }, select });
    } catch (error) {
      if (!isMissingTable(error)) throw error;
      return PAYMENT_PACKAGES.find((pkg) => pkg.code === cleanCode) ?? null;
    }

    if (!row) return null;
    if (!row.isActive) return null;
    return toPublic(row);
  }

  /** Daftar lengkap untuk konsol admin (termasuk paket nonaktif). */
  static async listForAdmin() {
    try {
      const rows = await prisma.paymentPackage.findMany({
        orderBy: [{ sortOrder: 'asc' }, { amountIdr: 'asc' }],
        select,
      });
      return {
        source: 'database' as const,
        packages: rows.map(toView),
      };
    } catch (error) {
      if (!isMissingTable(error)) throw error;
      return {
        source: 'fallback' as const,
        packages: PAYMENT_PACKAGES.map((pkg, index) => ({
          code: pkg.code,
          name: pkg.name,
          amount_idr: pkg.amountIdr,
          ctf_amount: pkg.ctfAmount,
          description: pkg.description,
          sort_order: (index + 1) * 10,
          is_active: true,
          updated_at: null,
          updated_by_id: null,
        })),
      };
    }
  }

  static async create(
    currentUser: PaymentPackageActor,
    input: CreatePaymentPackageInput,
    meta: RequestMeta = {}
  ) {
    this.assertSuperAdmin(currentUser);
    await AdminSecurityService.assertReauth(currentUser.id, input.password);
    const reason = assertReason(input.reason, 'pembuatan paket');

    const code = sanitizePackageCode(input.code);
    if (!code) {
      fail(422, 'INVALID_PACKAGE_CODE', 'Kode paket hanya boleh huruf kecil, angka, dan garis bawah');
    }

    const existing = await this.findRowOrThrowMissingTable(code);
    if (existing) fail(409, 'PACKAGE_CODE_TAKEN', `Kode paket "${code}" sudah dipakai`);

    const saved = await prisma.paymentPackage
      .create({
        data: {
          code,
          name: input.name.trim(),
          amountIdr: input.amountIdr,
          ctfAmount: input.ctfAmount,
          description: (input.description ?? '').trim(),
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true,
          updatedById: currentUser.id,
        },
        select,
      })
      .catch((error) => {
        if ((error as any)?.code === 'P2002') {
          fail(409, 'PACKAGE_CODE_TAKEN', `Kode paket "${code}" sudah dipakai`);
        }
        throw error;
      });

    await AdminSecurityService.writeAudit({
      actorId: currentUser.id,
      action: 'PAYMENT_PACKAGE_CREATED',
      targetType: 'PaymentPackage',
      targetId: code,
      reason,
      metadata: {
        code,
        name: saved.name,
        amount_idr: saved.amountIdr,
        ctf_amount: saved.ctfAmount,
        is_active: saved.isActive,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    invalidateCache(CACHE_PREFIX);
    await AdminSecurityService.writeAlert(
      'PAYOUT',
      `Super Admin ${currentUser.id} menambah paket top-up ${code} (Rp${saved.amountIdr} → ${saved.ctfAmount} CTF). Alasan: ${reason}`,
      'info'
    );

    return toView(saved);
  }

  static async update(
    currentUser: PaymentPackageActor,
    code: string,
    input: AdminPaymentPackageInput,
    meta: RequestMeta = {}
  ) {
    this.assertSuperAdmin(currentUser);
    await AdminSecurityService.assertReauth(currentUser.id, input.password);
    const reason = assertReason(input.reason, 'perubahan paket');

    const cleanCode = sanitizePackageCode(code);
    const previous = await this.findRowOrThrowMissingTable(cleanCode);
    if (!previous) fail(404, 'PACKAGE_NOT_FOUND', 'Paket top-up tidak ditemukan');

    const saved = await prisma.paymentPackage.update({
      where: { code: cleanCode },
      data: {
        name: input.name.trim(),
        amountIdr: input.amountIdr,
        ctfAmount: input.ctfAmount,
        description: (input.description ?? '').trim(),
        sortOrder: input.sortOrder ?? previous.sortOrder,
        isActive: input.isActive ?? previous.isActive,
        updatedById: currentUser.id,
      },
      select,
    });

    await AdminSecurityService.writeAudit({
      actorId: currentUser.id,
      action: 'PAYMENT_PACKAGE_UPDATED',
      targetType: 'PaymentPackage',
      targetId: cleanCode,
      reason,
      metadata: {
        code: cleanCode,
        previous: {
          name: previous.name,
          amount_idr: previous.amountIdr,
          ctf_amount: previous.ctfAmount,
          description: previous.description,
          sort_order: previous.sortOrder,
          is_active: previous.isActive,
        },
        next: {
          name: saved.name,
          amount_idr: saved.amountIdr,
          ctf_amount: saved.ctfAmount,
          description: saved.description,
          sort_order: saved.sortOrder,
          is_active: saved.isActive,
        },
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    invalidateCache(CACHE_PREFIX);
    await AdminSecurityService.writeAlert(
      'PAYOUT',
      `Super Admin ${currentUser.id} mengubah paket top-up ${cleanCode}: Rp${previous.amountIdr} → Rp${saved.amountIdr}, ${previous.ctfAmount} → ${saved.ctfAmount} CTF. Alasan: ${reason}`,
      'info'
    );

    return toView(saved);
  }

  static async setActive(
    currentUser: PaymentPackageActor,
    code: string,
    input: { isActive: boolean; reason: string; password?: string | null },
    meta: RequestMeta = {}
  ) {
    this.assertSuperAdmin(currentUser);
    await AdminSecurityService.assertReauth(currentUser.id, input.password);
    const reason = assertReason(input.reason, 'perubahan status paket');

    const cleanCode = sanitizePackageCode(code);
    const previous = await this.findRowOrThrowMissingTable(cleanCode);
    if (!previous) fail(404, 'PACKAGE_NOT_FOUND', 'Paket top-up tidak ditemukan');

    const saved = await prisma.paymentPackage.update({
      where: { code: cleanCode },
      data: { isActive: input.isActive, updatedById: currentUser.id },
      select,
    });

    await AdminSecurityService.writeAudit({
      actorId: currentUser.id,
      action: 'PAYMENT_PACKAGE_STATUS_CHANGED',
      targetType: 'PaymentPackage',
      targetId: cleanCode,
      reason,
      metadata: {
        code: cleanCode,
        previous_value: previous.isActive,
        new_value: input.isActive,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    invalidateCache(CACHE_PREFIX);
    await AdminSecurityService.writeAlert(
      'PAYOUT',
      `Super Admin ${currentUser.id} ${
        input.isActive ? 'mengaktifkan' : 'menonaktifkan'
      } paket top-up ${cleanCode}. Alasan: ${reason}`,
      input.isActive ? 'info' : 'error'
    );

    return toView(saved);
  }

  /**
   * Pratinjau harga massal tanpa menulis apa pun.
   *
   * Dipakai dialog konsol agar admin melihat CTF hasil hitungan sebelum
   * menyimpan. Perhitungannya sama persis dengan `bulkPrice`.
   */
  static async previewBulkPrice(input: BulkPriceInput) {
    const rows = await this.listAllRows();
    return {
      price_per_ctf: input.pricePerCtf,
      packages: this.priceRows(rows, input),
    };
  }

  /**
   * Terapkan satu harga dasar per CTF + bonus per paket ke SELURUH paket.
   *
   * Nominal rupiah tidak diubah; hanya `ctfAmount` yang dihitung ulang sebagai
   * `floor(amountIdr / pricePerCtf) + bonus`. Seluruh update berjalan dalam satu
   * transaksi bersama audit, jadi bila ada paket yang hasilnya di bawah 1 CTF
   * tidak satu pun paket tersimpan — katalog tidak pernah setengah harga.
   */
  static async bulkPrice(
    currentUser: PaymentPackageActor,
    input: BulkPriceInput,
    meta: RequestMeta = {}
  ) {
    this.assertSuperAdmin(currentUser);
    await AdminSecurityService.assertReauth(currentUser.id, input.password);
    const reason = assertReason(input.reason, 'penyesuaian harga massal');

    if (!Number.isInteger(input.pricePerCtf) || input.pricePerCtf < 100) {
      fail(422, 'INVALID_PRICE_PER_CTF', 'Harga per CTF minimal Rp100');
    }
    if (input.pricePerCtf > 10_000_000) {
      fail(422, 'INVALID_PRICE_PER_CTF', 'Harga per CTF maksimal Rp10.000.000');
    }

    const rows = await this.listAllRows();
    if (!rows.length) fail(409, 'NO_PACKAGES', 'Belum ada paket top-up yang bisa dihargai');

    const plan = this.priceRows(rows, input);

    const tooSmall = plan.filter((item) => item.ctfAmount < 1);
    if (tooSmall.length) {
      fail(
        422,
        'PACKAGE_CTF_TOO_SMALL',
        `Harga per CTF terlalu tinggi untuk paket ${tooSmall
          .map((item) => item.code)
          .join(', ')}. Turunkan harga per CTF atau tambah bonus.`
      );
    }

    const changes = plan.filter((item) => item.changed);

    await prisma.$transaction(async (tx) => {
      for (const item of changes) {
        await tx.paymentPackage.update({
          where: { code: item.code },
          data: { ctfAmount: item.ctfAmount, updatedById: currentUser.id },
          select,
        });
      }

      await AdminSecurityService.writeAudit(
        {
          actorId: currentUser.id,
          action: 'PAYMENT_PACKAGE_PRICING_CHANGED',
          targetType: 'PaymentPackage',
          targetId: 'bulk',
          reason,
          metadata: {
            price_per_ctf: input.pricePerCtf,
            packages: plan.map((item) => ({
              code: item.code,
              amount_idr: item.amountIdr,
              previous_ctf_amount: item.previousCtfAmount,
              base_ctf: item.baseCtf,
              bonus_ctf: item.bonusCtf,
              ctf_amount: item.ctfAmount,
            })),
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        tx
      );
    });

    invalidateCache(CACHE_PREFIX);

    if (changes.length) {
      await AdminSecurityService.writeAlert(
        'PAYOUT',
        `Super Admin ${currentUser.id} menyetel harga massal Rp${input.pricePerCtf}/CTF untuk ${changes.length} paket. Alasan: ${reason}`,
        'info'
      );
    }

    return {
      ...(await this.listForAdmin()),
      price_per_ctf: input.pricePerCtf,
      changed: changes.length,
      preview: plan,
    };
  }

  /** Semua paket (termasuk nonaktif) — harga massal berlaku untuk semuanya. */
  private static async listAllRows(): Promise<Row[]> {
    try {
      return await prisma.paymentPackage.findMany({
        orderBy: [{ sortOrder: 'asc' }, { amountIdr: 'asc' }],
        select,
      });
    } catch (error) {
      if (isMissingTable(error)) {
        fail(
          503,
          'PAYMENT_PACKAGE_TABLE_MISSING',
          'Tabel paket top-up belum dimigrasi. Jalankan prisma migrate deploy lebih dulu.'
        );
      }
      throw error;
    }
  }

  /**
   * Hitung rencana harga untuk semua paket.
   *
   * Bonus wajib dikirim untuk setiap paket: kalau satu paket terlewat, admin
   * tanpa sengaja menghapus bonus paket itu. Kode asing juga ditolak supaya
   * salah ketik tidak lolos diam-diam.
   */
  private static priceRows(rows: Row[], input: BulkPriceInput): BulkPriceRow[] {
    const bonusByCode = new Map(
      (input.packages ?? []).map((item) => [item.code, item.bonusCtf])
    );

    const unknown = [...bonusByCode.keys()].filter(
      (code) => !rows.some((row) => row.code === code)
    );
    if (unknown.length) {
      fail(422, 'UNKNOWN_PACKAGE_CODE', `Kode paket tidak dikenal: ${unknown.join(', ')}`);
    }

    const missing = rows.filter((row) => !bonusByCode.has(row.code));
    if (missing.length) {
      fail(
        422,
        'PACKAGE_BONUS_MISSING',
        `Bonus wajib diisi untuk semua paket: ${missing.map((row) => row.code).join(', ')}`
      );
    }

    return rows.map((row) => {
      const bonusCtf = Math.max(0, Math.trunc(bonusByCode.get(row.code) ?? 0) || 0);
      const baseCtf = Math.floor(row.amountIdr / input.pricePerCtf);
      const ctfAmount = baseCtf + bonusCtf;
      return {
        code: row.code,
        name: row.name,
        amountIdr: row.amountIdr,
        baseCtf,
        bonusCtf,
        ctfAmount,
        previousCtfAmount: row.ctfAmount,
        changed: ctfAmount !== row.ctfAmount,
      };
    });
  }

  private static assertSuperAdmin(currentUser: PaymentPackageActor) {
    if (currentUser.role !== 'Super Admin') {
      fail(403, 'FORBIDDEN', 'Hanya Super Admin yang dapat mengubah paket top-up');
    }
  }

  private static async findRowOrThrowMissingTable(code: string): Promise<Row | null> {
    try {
      return await prisma.paymentPackage.findUnique({ where: { code }, select });
    } catch (error) {
      if (isMissingTable(error)) {
        fail(
          503,
          'PAYMENT_PACKAGE_TABLE_MISSING',
          'Tabel paket top-up belum dimigrasi. Jalankan prisma migrate deploy lebih dulu.'
        );
      }
      throw error;
    }
  }
}