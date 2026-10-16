/**
 * Verifikasi render di PRODUKSI (Vercel) tanpa efek samping IG:
 * base dibuat dengan creatorId null → autoPostFess melewati publish Meta.
 * Fess panjang + emoji + kutipan → memaksa render multi-halaman (carousel).
 * Jalankan: npx tsx tmp_verify_prod.ts
 */
import fs from 'fs';
import axios from 'axios';
import { prisma } from './src/config/prisma.js';

const PROD = 'https://be-fnc.vercel.app';
const handle = `@safeprod${Date.now().toString(36)}`;

const longText = `Halo admin, aku mau curhat. Aku suka sama temen sekelas udah 2 tahun tapi gak pernah berani ngomong. Setiap hari aku cuma bisa lihat dia dari jauh, ketawa bareng temennya. Kadang dia nyapa aku dan jantungku rasanya mau copot 😭. Aku bingung harus gimana, temen-temen nyuruh aku confess aja tapi aku takut kalau pertemanan kita jadi aneh. Gimana ya menurut kalian? Aku butuh saran, jangan bully aku ya 🙏. Semoga kalian semua sehat dan bahagia, dikasih rezeki lancar, dan semoga aku diberi keberanian tahun ini. Amin!

Dan satu hal lagi, aku juga pengen bilang makasih ke admin yang udah bikin wadah ini. Kalian keren banget! Aku harap tahun ini aku bisa lebih berani ❤️ dan bisa bahagia bareng orang yang aku suka 🇮🇩👍🏽`;

async function main() {
  const base = await prisma.base.create({
    data: {
      name: 'Safe Prod Check',
      handle,
      initial: 'SP',
      category: 'Umum',
      creatorId: null,
      postMode: 'moderated',
    },
  });

  const fess = await prisma.fess.create({
    data: {
      baseHandle: handle,
      baseId: base.id,
      content: longText,
      status: 'published',
      tag: 'Curhat',
      template: 'default',
      quotedFess: {
        id: 'quoted_1',
        handle: '@anonim',
        content: 'Aku gak tau harus mulai dari mana, hidupku rasanya hampa banget akhir-akhir ini 😞',
        time: '2j lalu',
        avatar_bg: '#7000FF',
        avatar_text: 'AN',
      },
    },
  });

  console.log(`[prod-verify] base=${handle} fess=${fess.id}`);

  try {
    const res = await axios.post(
      `${PROD}/fesses/${fess.id}/instagram-post`,
      { template: 'default', aspect: 'portrait' },
      { timeout: 120000 }
    );
    const data = res.data?.data || res.data;
    console.log('[prod-verify] meta_published:', data.meta_published);
    console.log('[prod-verify] message:', data.message);
    const urls: string[] = data.image_urls || [];
    console.log('[prod-verify] jumlah halaman:', urls.length);

    for (let i = 0; i < urls.length; i++) {
      const img = await axios.get(urls[i], { responseType: 'arraybuffer', timeout: 60000 });
      const file = `tmp_prod_card_p${i + 1}.png`;
      fs.writeFileSync(file, Buffer.from(img.data));
      console.log(`[prod-verify] ${file} (${img.data.byteLength} bytes) ${urls[i]}`);
    }
  } finally {
    const logs = await prisma.systemLog.deleteMany({ where: { message: { contains: fess.id } } });
    await prisma.fess.delete({ where: { id: fess.id } });
    await prisma.base.delete({ where: { id: base.id } });
    console.log(`[prod-verify] cleanup selesai (${logs.count} systemLog dihapus)`);
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error('[prod-verify] GAGAL:', err.message);
  await prisma.$disconnect();
  process.exit(1);
});
