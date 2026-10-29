/**
 * Guard & fetcher gambar remote (foto cover thumbnail, avatar, dsb.).
 *
 * Dipakai untuk mencegah SSRF: hanya http(s), host publik, batas ukuran,
 * timeout, dan content-type gambar. Tidak ada dependency baru.
 *
 * Pemeriksaan host dilakukan **setelah resolusi DNS**, bukan hanya pada teks
 * URL. Nama domain yang tampak publik bisa saja menunjuk ke 127.0.0.1 atau
 * 169.254.169.254 (metadata cloud), dan bentuk numerik seperti `2130706433`
 * atau `0x7f000001` juga diartikan sebagai alamat IP oleh resolver sistem.
 */

import dns from 'node:dns/promises';
import net from 'node:net';

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

/** Rentang IPv4 yang tidak boleh dihubungi dari server. */
function isBlockedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b, c] = octets;

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // privat
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local / metadata cloud
  if (a === 172 && b >= 16 && b <= 31) return true; // privat
  if (a === 192 && b === 168) return true; // privat
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast & reserved
  return false;
}

/** Rentang IPv6 yang tidak boleh dihubungi dari server. */
function isBlockedIpv6(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, '');

  // IPv4-mapped (::ffff:127.0.0.1) — periksa bagian IPv4-nya.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (mapped) return isBlockedIpv4(mapped[1]);

  if (host === '::' || host === '::1') return true;
  if (host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) {
    return true; // link-local fe80::/10
  }
  if (host.startsWith('fc') || host.startsWith('fd')) return true; // unique local fc00::/7
  if (host.startsWith('ff')) return true; // multicast
  return false;
}

/** True bila alamat IP literal tidak boleh dihubungi. */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  // Bukan IP literal: anggap tidak aman, pemanggil harus me-resolve dulu.
  return true;
}

/** Hostname yang jelas-jelas hanya dipakai internal. */
function isBlockedHostname(host: string): boolean {
  return (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  );
}

/**
 * Verifikasi sinkron berbasis teks URL. Tetap dipakai untuk menolak cepat,
 * tetapi **bukan** pengganti `assertPublicHost()` karena tidak melihat hasil
 * resolusi DNS.
 */
export function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (isBlockedHostname(host)) return false;

    if (net.isIP(host)) return !isBlockedAddress(host);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve hostname lalu pastikan **semua** alamat hasilnya publik.
 *
 * Ini menutup trik nama domain yang menunjuk ke alamat internal serta bentuk
 * numerik non-standar (`2130706433`, `0x7f000001`) yang diterjemahkan resolver
 * menjadi 127.0.0.1. Catatan: `fetch` melakukan resolusi sendiri setelah
 * pemeriksaan ini, jadi serangan DNS-rebinding tingkat lanjut masih mungkin;
 * pertahanan penuh butuh koneksi yang di-pin ke IP hasil resolve.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isBlockedHostname(host)) {
    throw new Error('Host gambar tidak diizinkan.');
  }

  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new Error('Host gambar tidak diizinkan.');
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('Host gambar tidak dapat di-resolve.');
  }

  if (!addresses.length) throw new Error('Host gambar tidak dapat di-resolve.');
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new Error('Host gambar mengarah ke alamat internal.');
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
  await assertPublicHost(new URL(target).hostname);

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
    // Redirect bisa berakhir di host lain; periksa lagi hasil akhirnya.
    await assertPublicHost(new URL(response.url).hostname);

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
