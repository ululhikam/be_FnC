import { prisma } from '../config/prisma.js';
import { InstagramService } from '../services/instagram.service.js';

/**
 * Pemeliharaan token Instagram: long-lived token Meta hanya berlaku 60 hari.
 * Job ini memindai koneksi Instagram yang aktif dan memperpanjang token yang
 * mendekati kedaluwarsa (< 7 hari) agar auto-post tidak mati diam-diam.
 *
 * Dijalankan dari server.ts: sekali saat boot (delay kecil) + tiap 24 jam.
 * Token `mock_` & koneksi tanpa catatan expiry (hasil verifikasi manual lama)
 * dilewati — hubungkan ulang akun untuk mengaktifkan pemeliharaan otomatis.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_WINDOW_MS = 7 * DAY_MS;

export async function runInstagramTokenRefresh(): Promise<void> {
  const connections = await prisma.platformConnection.findMany({
    where: { platform: 'instagram', connected: true },
  });

  for (const conn of connections) {
    if (!conn.accessToken || conn.accessToken.startsWith('mock_')) continue;

    const metadata = (conn.metadata || {}) as Record<string, unknown>;
    const expiresRaw = metadata.tokenExpiresAt;
    const expiresAt = typeof expiresRaw === 'string' ? Date.parse(expiresRaw) : NaN;
    if (Number.isNaN(expiresAt)) continue; // expiry tidak diketahui — jangan tebak-tebakan
    if (expiresAt - Date.now() > REFRESH_WINDOW_MS) continue; // masih segar

    const label = conn.accountHandle || conn.userId || conn.id;
    try {
      const { accessToken, expiresIn } = await InstagramService.refreshLongLivedToken(
        conn.accessToken
      );
      await prisma.platformConnection.update({
        where: { id: conn.id },
        data: {
          accessToken,
          metadata: {
            ...metadata,
            tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
            tokenRefreshedAt: new Date().toISOString(),
          },
        },
      });
      await prisma.systemLog.create({
        data: {
          source: 'CANVAS_WORKER',
          message: `Token Instagram ${label} diperpanjang otomatis (+${Math.round(expiresIn / 86400)} hari).`,
          tone: 'ok',
        },
      });
    } catch (err: any) {
      const detail = err?.response?.data?.error?.message || err?.message || 'unknown error';
      console.warn(`[IG-TokenRefresh] Gagal memperpanjang token ${label}:`, detail);
      await prisma.systemLog
        .create({
          data: {
            source: 'CANVAS_WORKER',
            message: `Gagal memperpanjang token Instagram ${label}: ${detail}`,
            tone: 'error',
          },
        })
        .catch(() => {});
    }
  }
}

/** Jadwalkan refresh saat boot (delay kecil agar server siap) + tiap 24 jam. */
export function startInstagramTokenRefreshJob(): void {
  const run = () => {
    runInstagramTokenRefresh().catch((err) =>
      console.warn('[IG-TokenRefresh] Job error:', err?.message || err)
    );
  };

  setTimeout(run, 15_000).unref();
  setInterval(run, DAY_MS).unref();
}
