/**
 * Guard & fetcher gambar remote (foto cover thumbnail, avatar, dsb.).
 *
 * Dipakai untuk mencegah SSRF dasar: hanya http(s), host publik, batas ukuran,
 * timeout, dan content-type gambar. Tidak ada dependency baru.
 */

export interface RemoteImageOptions {
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
}

export interface RemoteImage {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
}

/** Hanya URL http(s) ke host publik (bukan loopback/privat/link-local). */
export function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      !host ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }

    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (ipv4) {
      const [a, b] = ipv4.slice(1).map(Number);
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      ) {
        return false;
      }
    }

    if (
      host.includes(':') &&
      (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Unduh gambar remote dengan batas ukuran & timeout. Melempar error generik
 * (tanpa membocorkan URL internal) supaya pemanggil bisa fallback.
 */
export async function fetchRemoteImage(
  rawUrl: string,
  options: RemoteImageOptions = {}
): Promise<RemoteImage> {
  const maxBytes = Math.max(1, Number(options.maxBytes) || 8 * 1024 * 1024);
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 8000);
  const accept = options.accept || 'image/*';
  const target = String(rawUrl || '').trim();
  if (!isPublicHttpUrl(target)) {
    throw new Error('URL gambar tidak diizinkan.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, {
      headers: { accept },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok || !isPublicHttpUrl(response.url)) {
      throw new Error(`Gagal mengambil gambar (HTTP ${response.status}).`);
    }

    const contentType = String(response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!contentType.startsWith('image/')) {
      throw new Error('Respons bukan gambar.');
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error('Ukuran gambar melebihi batas.');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('Gambar kosong.');
    if (buffer.length > maxBytes) throw new Error('Ukuran gambar melebihi batas.');

    return { buffer, contentType, finalUrl: response.url };
  } finally {
    clearTimeout(timer);
  }
}