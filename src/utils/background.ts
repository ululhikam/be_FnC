import { waitUntil } from '@vercel/functions';

/**
 * Daftarkan background task ke waitUntil runtime Vercel supaya tidak dipotong
 * saat response HTTP selesai. Di luar Vercel (dev/test) waitUntil tidak
 * tersedia — task tetap berjalan fire-and-forget dengan error yang tertangani.
 */
export function trackBackground(task: Promise<unknown>): void {
  const guarded = Promise.resolve(task).catch((err: any) => {
    console.warn('[Background] Task gagal:', err?.message || err);
  });

  try {
    waitUntil(guarded);
  } catch {
    /* runtime non-Vercel: promise berjalan sendiri & error sudah tertangani */
  }
}
