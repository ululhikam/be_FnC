import { prisma } from '../config/prisma.js';
import { AdminSecurityService } from './admin-security.service.js';

/**
 * Blast notifikasi sistem dari konsol Super Admin.
 *
 * Notifikasi masuk ke tabel yang sama dengan notifikasi aktivitas
 * (`Notification`, `type: 'system'`), jadi langsung tampil di halaman Activity
 * pengguna tanpa perubahan skema. Kanal sengaja in-app saja: tidak ada email,
 * sehingga tidak ada antrean tambahan maupun risiko spam.
 *
 * Pengiriman dibagi per 500 baris supaya satu permintaan tidak menahan koneksi
 * terlalu lama. Batch berikutnya baru jalan setelah batch sebelumnya sukses,
 * jadi jumlah yang dilaporkan selalu sama dengan yang benar-benar tersimpan.
 */

export const BROADCAST_BATCH_SIZE = 500;

export const BROADCAST_AUDIENCES = ['all', 'users', 'base_admins'] as const;
export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];

export type BroadcastInput = {
  title: string;
  body: string;
  audience: BroadcastAudience;
  reason: string;
  password?: string | null;
};

export type BroadcastRequestMeta = { ipAddress?: string | null; userAgent?: string | null };

/** Teks yang tersimpan: judul di baris pertama, isi di bawahnya. */
export function composeBroadcastText(title: string, body: string) {
  return `${String(title).trim()}\n\n${String(body).trim()}`.trim();
}

/**
 * Filter audiens. Akun terblokir selalu dilewati: mengirim pengumuman ke akun
 * yang sedang ditangguhkan tidak ada gunanya dan hanya menambah kebisingan.
 */
export function audienceWhere(audience: BroadcastAudience) {
  if (audience === 'users') return { isBanned: false, role: 'User' };
  if (audience === 'base_admins') return { isBanned: false, role: 'Base Admin' };
  return { isBanned: false };
}

export class AdminNotificationService {
  /** Hitung penerima tanpa mengirim apa pun (pratinjau di dialog). */
  static async preview(audience: BroadcastAudience) {
    const recipients = await prisma.user.count({ where: audienceWhere(audience) });
    return { audience, recipients };
  }

  /**
   * Kirim blast ke seluruh penerima sesuai audiens.
   *
   * Wajib re-auth + alasan karena aksi ini menjangkau semua pengguna sekaligus.
   */
  static async broadcast(
    actorId: string,
    input: BroadcastInput,
    meta: BroadcastRequestMeta = {}
  ) {
    await AdminSecurityService.assertReauth(actorId, input.password);

    const reason = String(input.reason ?? '').trim();
    if (reason.length < 5) {
      const err: any = new Error('Alasan wajib diisi minimal 5 karakter');
      err.status = 422;
      err.code = 'REASON_REQUIRED';
      throw err;
    }

    const audience = input.audience;
    const text = composeBroadcastText(input.title, input.body);

    const recipients = await prisma.user.findMany({
      where: audienceWhere(audience),
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!recipients.length) {
      return {
        audience,
        recipients: 0,
        created: 0,
        batches: 0,
        message: 'Tidak ada penerima aktif untuk audiens ini.',
      };
    }

    let created = 0;
    let batches = 0;

    for (let offset = 0; offset < recipients.length; offset += BROADCAST_BATCH_SIZE) {
      const slice = recipients.slice(offset, offset + BROADCAST_BATCH_SIZE);
      await prisma.notification.createMany({
        data: slice.map((user) => ({
          userId: user.id,
          type: 'system',
          text,
        })),
      });
      created += slice.length;
      batches += 1;
    }

    await AdminSecurityService.writeAudit({
      actorId,
      action: 'NOTIFICATION_BROADCAST',
      targetType: 'Notification',
      targetId: audience,
      reason,
      metadata: {
        title: String(input.title).trim(),
        audience,
        recipients: recipients.length,
        created,
        batches,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    // Terlihat juga di log mesin: blast menyentuh seluruh pengguna, jadi perlu
    // muncul saat memantau konsol Sistem, bukan hanya di tabel audit.
    await AdminSecurityService.writeAlert(
      'NOTIFICATION',
      `Blast "${String(input.title).trim()}" terkirim ke ${created} pengguna (audiens: ${audience}).`,
      'info'
    );

    return {
      audience,
      recipients: recipients.length,
      created,
      batches,
      message: `Notifikasi terkirim ke ${created} pengguna.`,
    };
  }
}