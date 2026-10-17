import axios from 'axios';
import sharp from 'sharp';
import { StorageService } from '../services/storage.service.js';

/**
 * Instagram Content Publishing hanya menerima gambar **JPEG**. Util ini
 * memastikan setiap URL gambar yang dipakai container Meta berformat JPEG:
 *
 *  - URL berekstensi .jpg/.jpeg → langsung dipakai (tanpa request jaringan).
 *  - URL lain (PNG/WebP/GIF/…, atau tanpa ekstensi) → cek content-type;
 *    bila bukan JPEG, unduh → konversi (sharp) → unggah ulang ke storage
 *    (folder `ig-jpeg/`) → kembalikan URL publik yang baru.
 *
 * Hasil per URL di-cache di memori (termasuk promise in-flight) supaya satu
 * gambar tidak dikonversi berulang kali; kegagalan TIDAK di-cache.
 */

const JPEG_URL_RE = /\.(jpe?g)($|[?#])/i;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024; // batas aman unduhan media
const IG_MAX_JPEG_BYTES = 8 * 1024 * 1024; // batas ukuran gambar Instagram
const CACHE_LIMIT = 200;

const jpegUrlCache = new Map<string, Promise<string>>();

/**
 * Kembalikan URL publik berformat JPEG untuk sebuah gambar Instagram.
 * URL yang sudah JPEG dikembalikan apa adanya (cepat, tanpa jaringan).
 */
export async function ensureJpegUrl(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return url; // pemanggil yang memfilter data-URI
  if (JPEG_URL_RE.test(url)) return url;

  const cached = jpegUrlCache.get(url);
  if (cached) return cached;

  const task = convertToPublicJpeg(url);
  jpegUrlCache.set(url, task);
  if (jpegUrlCache.size > CACHE_LIMIT) {
    const oldest = jpegUrlCache.keys().next().value;
    if (oldest && oldest !== url) jpegUrlCache.delete(oldest);
  }

  try {
    return await task;
  } catch (err) {
    jpegUrlCache.delete(url); // kegagalan tidak di-cache agar bisa dicoba lagi
    throw err;
  }
}

/** Unduh gambar non-JPEG, konversi, lalu unggah sebagai JPEG publik. */
async function convertToPublicJpeg(url: string): Promise<string> {
  // Jalur cepat: content-type di server sudah JPEG (URL tanpa ekstensi .jpg).
  try {
    const head = await axios.head(url, { timeout: 8000, validateStatus: () => true });
    const contentType = String(head.headers?.['content-type'] || '').toLowerCase();
    if (head.status < 400 && contentType.includes('image/jpeg')) return url;
  } catch {
    // Sebagian host tidak mendukung HEAD — lanjut ke unduhan penuh.
  }

  let buffer: Buffer;
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxContentLength: MAX_DOWNLOAD_BYTES,
      maxBodyLength: MAX_DOWNLOAD_BYTES,
    });
    const contentType = String(res.headers?.['content-type'] || '').toLowerCase();
    if (contentType.includes('image/jpeg')) return url;
    buffer = Buffer.from(res.data);
  } catch (err: any) {
    throw new Error(`Gagal mengunduh gambar untuk konversi JPEG (${url}): ${err?.message || err}`);
  }

  let jpeg: Buffer;
  try {
    jpeg = await sharp(buffer)
      .rotate() // hormati orientasi EXIF
      .flatten({ background: '#ffffff' }) // hilangkan alpha (PNG/WebP transparan)
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();

    if (jpeg.length > IG_MAX_JPEG_BYTES) {
      // Terlalu besar → resize + kompresi lebih kuat agar muat batas Instagram.
      jpeg = await sharp(buffer)
        .rotate()
        .flatten({ background: '#ffffff' })
        .resize({ width: 1440, height: 1440, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
    }
  } catch (err: any) {
    throw new Error(`Gagal mengonversi media ke JPEG (${url}): ${err?.message || err}`);
  }

  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: `ig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`,
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: jpeg.length,
    buffer: jpeg,
    destination: '',
    filename: '',
    path: '',
    stream: null as any,
  };

  const upload = await StorageService.uploadMedia(mockFile, 'ig-jpeg');
  if (!upload?.url || upload.url.startsWith('data:')) {
    throw new Error(`Konversi JPEG berhasil tetapi upload storage gagal (${url}).`);
  }
  return upload.url;
}
