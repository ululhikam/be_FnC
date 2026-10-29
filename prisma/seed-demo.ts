import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Akun demo untuk reviewer payment gateway (Midtrans).
 *
 * Sengaja DIPISAH dari prisma/seed.ts:
 *  • seed.ts dipakai untuk data contoh di semua environment;
 *  • akun demo hanya dibutuhkan selama proses verifikasi dan harus bisa
 *    dijalankan ulang (reset password) atau dimatikan tanpa mengganggu seed.
 *
 * Jalankan:
 *   npm run seed:demo          (memakai .env)
 *   npm run seed:demo:dev      (memakai .env.development)
 *
 * Matikan sementara tanpa menghapus akun:
 *   DEMO_ACCOUNT_ENABLED=false npm run seed:demo
 */

const prisma = new PrismaClient();

const DEMO_EMAIL = process.env.DEMO_ACCOUNT_EMAIL || 'demo@fessncurious.com';
const DEMO_PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD || 'midtransdemo';
const DEMO_HANDLE = process.env.DEMO_ACCOUNT_HANDLE || '@demo_midtrans';
const DEMO_USERNAME = process.env.DEMO_ACCOUNT_USERNAME || 'Demo Reviewer';

const BCRYPT_ROUNDS = 10;

async function main() {
  if (process.env.DEMO_ACCOUNT_ENABLED === 'false') {
    console.log('⏭️  DEMO_ACCOUNT_ENABLED=false — akun demo tidak dibuat/diubah.');
    return;
  }

  // handle dan email sama-sama unik. Cari lewat keduanya supaya tidak gagal
  // ketika salah satu nilai sudah dipakai (mis. email didaftarkan manual).
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ handle: DEMO_HANDLE }, { email: DEMO_EMAIL }],
    },
    select: { id: true, handle: true, email: true, role: true },
  });

  if (existing && existing.role !== 'User') {
    throw new Error(
      `Akun dengan handle ${DEMO_HANDLE} / email ${DEMO_EMAIL} sudah ada dengan role ` +
        `"${existing.role}". Akun demo harus role "User" — ganti DEMO_ACCOUNT_HANDLE ` +
        `atau DEMO_ACCOUNT_EMAIL.`
    );
  }

  const password = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);

  /**
   * emailVerifiedAt WAJIB diisi. auth.service.ts menolak login untuk akun
   * ber-email yang belum terverifikasi, sehingga akun demo tanpa field ini
   * akan gagal masuk tanpa pesan yang jelas.
   */
  const data = {
    username: DEMO_USERNAME,
    handle: DEMO_HANDLE,
    email: DEMO_EMAIL,
    emailVerifiedAt: new Date(),
    password,
    role: 'User',
    isBanned: false,
    banReason: null,
    banExpiresAt: null,
    bio: 'Akun demo untuk peninjauan integrasi pembayaran.',
  };

  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data })
    : await prisma.user.create({ data });

  // Pastikan dompet CTF ada agar halaman Dompet langsung bisa dibuka.
  await prisma.ctfWallet.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, balance: 0 },
  });

  console.log('✅ Akun demo siap dipakai:');
  console.log(`   Email    : ${DEMO_EMAIL}`);
  console.log(`   Password : ${DEMO_PASSWORD}`);
  console.log(`   Handle   : ${DEMO_HANDLE}`);
  console.log(`   Status   : ${existing ? 'diperbarui (password di-reset)' : 'dibuat baru'}`);
}

main()
  .catch((e) => {
    console.error('❌ Gagal menyiapkan akun demo:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
