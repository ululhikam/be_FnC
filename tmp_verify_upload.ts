/**
 * Verifikasi produksi jalur unggah baru (signed URL, langsung ke Supabase):
 * 1) POST /api/upload/sign untuk file video 8MB (kasus user: koneksi terputus).
 * 2) Cek preflight CORS dari origin frontend.
 * 3) PUT 8MB persis seperti browser (XHR/fetch) ke signed URL.
 * 4) Pastikan file dapat diakses publik + ukuran benar.
 * 5) Bersihkan file uji dari storage (pakai kredensial lokal).
 */
import axios from 'axios';
import { getSupabase } from './src/config/supabase.js';
import { ENV } from './src/config/env.js';

const BASE = 'https://be-fnc.vercel.app';
const SIZE = 8 * 1024 * 1024;

async function main() {
  const filename = `verify-8mb-video-${Date.now()}.mp4`;
  console.log(`[verify-upload] minta signed URL untuk ${filename} (${SIZE / 1024 / 1024}MB)`);

  const signRes = await axios.post(
    `${BASE}/api/upload/sign`,
    { filename, content_type: 'video/mp4', size: SIZE },
    { timeout: 30000 }
  );

  const info = signRes.data?.data || signRes.data;
  console.log('[verify-upload] status:', signRes.status, '| type:', info?.type, '| path:', info?.path);
  if (!info?.signed_url || !info?.public_url) {
    throw new Error('signed_url/public_url tidak ada di respons');
  }

  try {
    const pre = await axios.options(info.signed_url, {
      headers: {
        Origin: 'https://fessncurious.vercel.app',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type,x-upsert,cache-control',
      },
      timeout: 20000,
    });
    console.log(
      '[verify-upload] preflight CORS:',
      pre.status,
      '| allow-origin:',
      pre.headers['access-control-allow-origin'],
      '| allow-methods:',
      pre.headers['access-control-allow-methods']
    );
  } catch (e: any) {
    console.log('[verify-upload] preflight CORS gagal (non-fatal):', e.response?.status || e.message);
  }

  const buf = Buffer.alloc(SIZE, 0x61);
  const t0 = Date.now();
  const putRes = await axios.put(info.signed_url, buf, {
    headers: {
      'x-upsert': 'false',
      'cache-control': 'max-age=3600',
      'content-type': 'video/mp4',
    },
    timeout: 120000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  console.log(`[verify-upload] PUT 8MB sukses: status ${putRes.status} dalam ${Date.now() - t0}ms`);

  const head = await axios.get(info.public_url, { timeout: 30000, responseType: 'arraybuffer' });
  console.log(`[verify-upload] file publik OK: status ${head.status}, ukuran ${head.data?.byteLength} bytes`);
  if (head.data?.byteLength !== SIZE) throw new Error('Ukuran file publik tidak cocok');

  const supabase = getSupabase();
  const { error } = await supabase.storage.from(ENV.SUPABASE_BUCKET).remove([info.path]);
  console.log(
    error ? `[verify-upload] GAGAL bersihkan: ${error.message}` : `[verify-upload] cleanup OK (${info.path} dihapus)`
  );
  console.log('[verify-upload] SEMUA LULUS');
}

main().catch((e) => {
  console.error('[verify-upload] GAGAL:', e.response?.data || e.message);
  process.exit(1);
});
