/**
 * cache.util — cache in-memory TTL kecil untuk endpoint GET yang sering dibaca.
 * ---------------------------------------------------------------------------
 * Best practice yang dipakai di sini:
 *   - Data katalog (direktori base) boleh sedikit tertinggal beberapa detik,
 *     jadi TTL pendek (20-30 detik) memberi efek "native app" tanpa membuat
 *     data basi.
 *   - Setiap mutasi yang mengubah data ter-cache WAJIB memanggil
 *     `invalidateCache(prefix)` sehingga user selalu melihat data terbaru
 *     dalam siklus request berikutnya.
 *   - Hanya dipakai untuk payload JSON kecil; bukan pengganti CDN/Redis.
 */

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

/** Ambil nilai cache bila masih segar (undefined bila kosong/basi). */
export function cacheGet<T = unknown>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

/** Simpan nilai cache dengan TTL (ms). */
export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Hapus semua entry dengan prefix tertentu.
 * Contoh: `invalidateCache('bases:')` membersihkan seluruh variasi query base.
 */
export function invalidateCache(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Ambil dari cache; bila kosong jalankan `fetcher` lalu simpan hasilnya. */
export async function getOrSet<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await fetcher();
  cacheSet(key, value, ttlMs);
  return value;
}
