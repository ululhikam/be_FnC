/**
 * TEMP SCRIPT (verifikasi produksi) — render card via endpoint PRODUKSI memakai
 * base tanpa creator (tidak ada koneksi IG → tidak ada publish), unduh PNG hasil
 * render Vercel, lalu bereskan data uji.
 *
 * Jalankan: npx tsx tmp_verify_prod_font.ts — hapus setelah selesai.
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config();

const prisma = new PrismaClient();
const BASE_HANDLE = '@vercel_font_test';
const PROD = 'https://be-fnc.vercel.app';

async function cleanup(fessId: string) {
  try {
    await prisma.systemLog.deleteMany({ where: { message: { contains: fessId } } });
    await prisma.fess.deleteMany({ where: { id: fessId } });
    await prisma.base.deleteMany({ where: { handle: BASE_HANDLE } });
    console.log('[cleanup] data uji dihapus.');
  } catch (e: any) {
    console.warn('[cleanup] gagal:', e.message);
  }
}

async function main() {
  const base = await prisma.base.upsert({
    where: { handle: BASE_HANDLE },
    update: { creatorId: null },
    create: { handle: BASE_HANDLE, name: 'Vercel Font Test', category: 'Umum', creatorId: null },
  });
  console.log('base uji siap:', base.id, '| creator:', base.creatorId);

  const fess = await prisma.fess.create({
    data: {
      baseHandle: BASE_HANDLE,
      baseId: base.id,
      content:
        'Emoji tspan: 😭🔥❤️😀🙏 👍🏽 🇮🇩 dan teks Kongrés 123 — @concern_fess',
      template: 'default',
      status: 'published',
    },
  });
  console.log('fess uji siap:', fess.id);

  console.log('\nMemanggil endpoint PRODUKSI (render di Vercel, tanpa publish IG)...');
  const t0 = Date.now();
  let ok = false;
  try {
    const res = await axios.post(
      `${PROD}/fesses/${fess.id}/instagram-post`,
      { template: 'default', aspect: 'portrait' },
      { timeout: 120000, headers: { 'Content-Type': 'application/json' } }
    );
    console.log(`HTTP ${res.status} dalam ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const d = res.data || {};
    console.log('meta_published:', d.meta_published, '| posted_to:', JSON.stringify(d.posted_to));
    console.log('message:', d.message);
    console.log('image_url:', d.image_url);

    if (d.image_url) {
      const bin = await axios.get(d.image_url, { responseType: 'arraybuffer', timeout: 60000 });
      fs.writeFileSync(path.join(__dirname, 'tmp_prod_render.png'), Buffer.from(bin.data));
      console.log(`\n>>> Gambar hasil render Vercel disimpan: tmp_prod_render.png (${bin.data.byteLength} bytes)`);
      ok = true;
    }
  } catch (e: any) {
    console.log('HTTP ERROR', e.response?.status, JSON.stringify(e.response?.data ?? e.message));
  }

  if (ok) await cleanup(fess.id);
  else console.log('Render gagal — data uji TIDAK dihapus supaya bisa diperiksa ulang.');
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
