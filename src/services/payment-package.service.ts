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