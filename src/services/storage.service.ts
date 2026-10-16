import { getSupabase } from '../config/supabase.js';
import { ENV } from '../config/env.js';

export interface UploadResult {
  url: string;
  thumbnail?: string;
  size: number;
  type: 'image' | 'video';
}

/** Batas ukuran file yang boleh memakai fallback data-URI (dev tanpa storage). */
const DATA_URI_MAX_BYTES = 2 * 1024 * 1024;

/** Storage dianggap siap pakai bila kredensial diisi (bukan placeholder dummy). */
function isStorageConfigured(): boolean {
  return (
    !!ENV.SUPABASE_URL &&
    !ENV.SUPABASE_URL.includes('dummy') &&
    !!ENV.SUPABASE_KEY &&
    ENV.SUPABASE_KEY !== 'dummy-supabase-key'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMsg)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

export class StorageService {
  /**
   * Upload file to Supabase Object Storage.
   *
   * - Storage terkonfigurasi: upload + 1x percobaan ulang dengan proteksi timeout 25s.
   * - Storage belum dikonfigurasi (dev/test tanpa kredensial): fallback data-URI untuk file < 2MB.
   */
  static async uploadMedia(file: Express.Multer.File, folder = 'media'): Promise<UploadResult> {
    const rawExt = file.originalname.split('.').pop() || '';
    const cleanExt = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '');
    const isVideo =
      file.mimetype.startsWith('video/') ||
      ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'].includes(cleanExt);
    const type: 'image' | 'video' = isVideo ? 'video' : 'image';
    const ext = cleanExt || (isVideo ? 'mp4' : 'jpg');
    const filename = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    let contentType = file.mimetype;
    if (!contentType || contentType === 'application/octet-stream') {
      if (isVideo) contentType = ext === 'webm' ? 'video/webm' : 'video/mp4';
      else if (ext === 'png') contentType = 'image/png';
      else if (ext === 'webp') contentType = 'image/webp';
      else if (ext === 'gif') contentType = 'image/gif';
      else contentType = 'image/jpeg';
    }

    if (isStorageConfigured()) {
      let lastError = 'penyebab tidak diketahui';

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const supabase = getSupabase();
          const { data, error } = await withTimeout(
            supabase.storage
              .from(ENV.SUPABASE_BUCKET)
              .upload(filename, file.buffer, {
                contentType,
                upsert: true,
              }),
            120000,
            'Batas waktu penyimpanan Supabase Storage terlampaui (120s)'
          );

          if (!error && data?.path) {
            const { data: publicUrlData } = supabase.storage
              .from(ENV.SUPABASE_BUCKET)
              .getPublicUrl(data.path);

            return {
              url: publicUrlData.publicUrl,
              thumbnail: isVideo ? publicUrlData.publicUrl : undefined,
              size: file.size,
              type,
            };
          }

          lastError = error?.message || 'respons storage tidak valid';
        } catch (e: any) {
          lastError = e?.message || String(e);
        }

        if (attempt < 2) await sleep(400);
      }

      console.error(
        `[storage] Gagal mengunggah ${filename} ke Supabase Storage setelah 2 percobaan: ${lastError}`
      );
      throw new Error(`Gagal mengunggah file ke storage (${lastError}). Coba lagi beberapa saat.`);
    }

    // Dev/test tanpa kredensial storage: data-URI hanya untuk file kecil.
    if (file.size < DATA_URI_MAX_BYTES) {
      const dataUri = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
      return {
        url: dataUri,
        thumbnail: isVideo ? dataUri : undefined,
        size: file.size,
        type,
      };
    }

    throw new Error(
      'Storage media belum dikonfigurasi (SUPABASE_URL/SUPABASE_KEY) dan file terlalu besar untuk fallback dev (maks 2MB).'
    );
  }

  /**
   * Upload and optimize avatar image (max 150x150)
   */
  static async uploadAvatar(file: Express.Multer.File): Promise<string> {
    const result = await this.uploadMedia(file, 'avatars');
    return result.url;
  }
}
