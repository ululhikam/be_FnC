import axios from 'axios';
import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';
import { StorageService } from '../services/storage.service.js';
import { renderSvgToPng } from './svg-render.util.js';
import { watermarkLabel } from './thumbnail.util.js';

/**
 * Instagram Content Publishing memiliki dua batasan yang saling terkait:
 *
 *  1. Setiap gambar harus JPEG.
 *  2. Semua item dalam satu carousel harus memiliki rasio aspek yang sama.
 *
 * Util ini menormalkan gambar user ke kanvas 4:5 (1080×1350) dengan mode
 * `contain`, sehingga foto apa pun bisa dicampur dengan card fess tanpa membuat
 * container Meta berstatus ERROR. Sisa ruang (letterbox) diisi salinan foto yang
 * di-cover + di-blur — bukan putih polos — supaya bingkai mengikuti warna foto.
 */

export interface IgTargetDimensions {
  width: number;
  height: number;
}

export const IG_CAROUSEL_TARGET: IgTargetDimensions = { width: 1080, height: 1350 };

/** Watermark foto asli: handle base di atas, host platform di bawah. */
export interface IgWatermark {
  handle: string;
  host: string;
}

export interface IgNormalizeOptions {
  /** Dipasang setelah foto dinormalkan; `null`/kosong = tanpa watermark. */
  watermark?: IgWatermark | null;
}

const JPEG_URL_RE = /\.(jpe?g)($|[?#])/i;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024; // batas aman unduhan media
const IG_MAX_JPEG_BYTES = 8 * 1024 * 1024; // batas ukuran gambar Instagram
const CACHE_LIMIT = 200;

const jpegUrlCache = new Map<string, Promise<string>>();
const normalizedImageCache = new Map<string, Promise<{ url: string; width: number; height: number }>>();

export interface IgImageResult {
  url: string;
  width: number;
  height: number;
}

/**
 * Kembalikan URL publik berformat JPEG untuk sebuah gambar Instagram.
 * URL yang sudah JPEG dikembalikan apa adanya (cepat, tanpa jaringan).
 *
 * Catatan: fungsi ini hanya menjamin format. Untuk carousel gunakan
 * `ensureIgImageUrl()` yang juga menjamin dimensi 4:5.
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

/**
 * Normalkan gambar ke JPEG dengan dimensi persis target (default 1080×1350).
 * Jika gambar sudah JPEG dan sudah berukuran tepat, URL asli dipakai kembali.
 */
export async function ensureIgImageUrl(
  url: string,
  target: IgTargetDimensions = IG_CAROUSEL_TARGET,
  options: IgNormalizeOptions = {}
): Promise<IgImageResult> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('URL gambar Instagram harus berupa HTTP(S) publik.');
  }

  const cacheKey = `${target.width}x${target.height}:${watermarkKey(options.watermark)}:${url}`;
  const cached = normalizedImageCache.get(cacheKey);
  if (cached) return cached;

  const task = normalizeImageUrl(url, target, options);
  normalizedImageCache.set(cacheKey, task);
  if (normalizedImageCache.size > CACHE_LIMIT) {
    const oldest = normalizedImageCache.keys().next().value;
    if (oldest && oldest !== cacheKey) normalizedImageCache.delete(oldest);
  }

  try {
    return await task;
  } catch (err) {
    normalizedImageCache.delete(cacheKey);
    throw err;
  }
}

/** Unduh gambar lalu konversi/pad ke JPEG dengan dimensi persis target. */
async function normalizeImageUrl(
  url: string,
  target: IgTargetDimensions,
  options: IgNormalizeOptions = {}
): Promise<IgImageResult> {
  const watermark = normalizeWatermark(options.watermark);
  let buffer: Buffer;
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxContentLength: MAX_DOWNLOAD_BYTES,
      maxBodyLength: MAX_DOWNLOAD_BYTES,
    });
    const contentType = String(res.headers?.['content-type'] || '').toLowerCase();
    if (contentType && !contentType.includes('image/')) {
      throw new Error(`content-type ${contentType} bukan gambar`);
    }
    buffer = Buffer.from(res.data);
  } catch (err: any) {
    throw new Error(`Gagal mengunduh gambar untuk normalisasi Instagram (${url}): ${err?.message || err}`);
  }

  // Jalur cepat: sudah JPEG + dimensi tepat → tidak perlu upload ulang. Tidak
  // berlaku saat watermark diminta, karena foto harus digambar ulang.
  if (!watermark) {
    try {
      const meta = await sharp(buffer).metadata();
      if (
        meta.format === 'jpeg' &&
        meta.width === target.width &&
        meta.height === target.height &&
        (!meta.orientation || meta.orientation === 1) &&
        buffer.length <= IG_MAX_JPEG_BYTES
      ) {
        return { url, width: target.width, height: target.height };
      }
    } catch {
      // Biarkan sharp di bawah menghasilkan error yang lebih jelas.
    }
  }

  const jpeg = await normalizeImageBuffer(buffer, target, options);
  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: `ig_${target.width}x${target.height}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}.jpg`,
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
    throw new Error(`Normalisasi gambar berhasil tetapi upload storage gagal (${url}).`);
  }

  return { url: upload.url, width: target.width, height: target.height };
}

/** Sharp: rotate EXIF → contain di atas salinan foto blur → watermark → JPEG ≤ 8 MB. */
export async function normalizeImageBuffer(
  buffer: Buffer,
  target: IgTargetDimensions = IG_CAROUSEL_TARGET,
  options: IgNormalizeOptions = {}
): Promise<Buffer> {
  const watermark = normalizeWatermark(options.watermark);
  let jpeg: Buffer;
  try {
    const source = sharp(buffer, { failOn: 'none' }).rotate();

    // Latar letterbox: salinan foto yang di-cover lalu di-blur. Warna bingkai
    // otomatis mengikuti foto, jadi foto non-4:5 tidak lagi berbingkai putih.
    const backdrop = await source
      .clone()
      .resize(target.width, target.height, { fit: 'cover', position: 'centre' })
      .blur(36)
      .modulate({ brightness: 0.86, saturation: 1.06 })
      .removeAlpha()
      .toBuffer();

    // Foto utama utuh (tanpa crop), padding transparan agar latar blur terlihat.
    const foreground = await source
      .clone()
      .resize({
        width: target.width,
        height: target.height,
        fit: 'contain',
        position: 'centre',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    const layers: OverlayOptions[] = [{ input: foreground, gravity: 'centre' }];
    if (watermark) {
      // Overlay teks dirender lewat resvg (font bundled) supaya tipografi sama
      // di lokal dan Vercel. sharp().composite(svg) akan memakai font sistem.
      layers.push({ input: renderSvgToPng(buildWatermarkSvg(target, watermark)), top: 0, left: 0 });
    }

    const base = sharp(backdrop).composite(layers);

    jpeg = await base.clone().jpeg({ quality: 92, mozjpeg: true }).toBuffer();

    if (jpeg.length > IG_MAX_JPEG_BYTES) {
      jpeg = await base.clone().jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    }
    if (jpeg.length > IG_MAX_JPEG_BYTES) {
      jpeg = await base.clone().jpeg({ quality: 68, mozjpeg: true }).toBuffer();
    }
  } catch (err: any) {
    throw new Error(`Gagal menormalkan gambar ke ${target.width}×${target.height}: ${err?.message || err}`);
  }

  return jpeg;
}

/** Nama file aman untuk watermark (dipakai hanya di SVG). */
function escapeXml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Watermark dinormalkan sekali agar cache key & render selalu sepakat. */
function normalizeWatermark(value?: IgWatermark | null): IgWatermark | null {
  if (!value) return null;
  const handle = String(value.handle ?? '').trim();
  const host = String(value.host ?? '').trim();
  if (!handle && !host) return null;
  return watermarkLabel(handle, host);
}

function watermarkKey(value?: IgWatermark | null): string {
  const watermark = normalizeWatermark(value);
  return watermark ? `${watermark.handle}|${watermark.host}` : 'none';
}

/**
 * SVG transparan berisi watermark foto asli: `@handle` base di kiri-atas dan
 * host platform di kanan-bawah. Scrim gradien tipis di tiap tepi membuat teks
 * tetap terbaca di atas foto terang tanpa menutupi foto itu sendiri.
 */
export function buildWatermarkSvg(target: IgTargetDimensions, watermark: IgWatermark): string {
  const { handle, host } = watermark;
  const { width, height } = target;
  const margin = Math.round(width * 0.045); // 48 px pada 1080
  const handleSize = Math.round(width * 0.028); // ±30 px
  const hostSize = Math.round(width * 0.02); // ±22 px
  const scrimHeight = Math.round(height * 0.16);
  const handleBaseline = margin + Math.round(handleSize * 0.95);
  const hostBaseline = height - margin - Math.round(hostSize * 0.4);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="wmTop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05070c" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#05070c" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="wmBottom" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05070c" stop-opacity="0"/>
      <stop offset="1" stop-color="#05070c" stop-opacity="0.62"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${scrimHeight}" fill="url(#wmTop)"/>
  <rect y="${height - scrimHeight}" width="${width}" height="${scrimHeight}" fill="url(#wmBottom)"/>
  <text x="${margin}" y="${handleBaseline}" font-family="Poppins, sans-serif" font-size="${handleSize}" font-weight="600" fill="#ffffff" fill-opacity="0.94">${escapeXml(handle)}</text>
  <text x="${width - margin}" y="${hostBaseline}" text-anchor="end" font-family="Fira Mono, monospace" font-size="${hostSize}" font-weight="400" fill="#ffffff" fill-opacity="0.82">${escapeXml(host)}</text>
</svg>`;
}

export interface CarouselGeometryItem {
  type?: string;
  url?: string;
  width?: number;
  height?: number;
  duration?: number | null;
}

/**
 * Validasi defensif sebelum container Meta dibuat. Semua item carousel wajib
 * memiliki dimensi yang sama persis dengan target 4:5.
 */
export function assertCarouselGeometry(
  items: CarouselGeometryItem[],
  target: IgTargetDimensions = IG_CAROUSEL_TARGET
): void {
  items.forEach((item, index) => {
    const width = Number(item.width);
    const height = Number(item.height);
    const label = item.type === 'video' ? 'video' : 'gambar';

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error(
        `Item carousel #${index + 1} (${label}) belum memiliki metadata dimensi. ` +
          `Semua media harus dinormalisasi ke ${target.width}×${target.height} (4:5) sebelum diposting.`
      );
    }

    if (width !== target.width || height !== target.height) {
      throw new Error(
        `Item carousel #${index + 1} (${label}) berukuran ${width}×${height}; ` +
          `semua item Instagram harus ${target.width}×${target.height} (4:5).`
      );
    }
  });
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
