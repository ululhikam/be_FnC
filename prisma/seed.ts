// import { PrismaClient } from '@prisma/client';
// import bcrypt from 'bcryptjs';
// import { TOPICS } from '../src/constants/topics.js';
// import { SONGS } from '../src/constants/songs.js';

// const prisma = new PrismaClient();

// async function main() {
//   console.log('🌱 Starting database seeding...');

//   const defaultPassword = await bcrypt.hash('password123', 10);

//   // 1. Create Super Admin
//   const superAdmin = await prisma.user.upsert({
//     where: { handle: '@superadmin' },
//     update: {},
//     create: {
//       id: 'usr_admin_01',
//       username: 'SuperAdmin_GodMode',
//       handle: '@superadmin',
//       email: 'superadmin@fessncurious.app',
//       password: defaultPassword,
//       role: 'Super Admin',
//       avatar:
//         'https://images.unsplash.com/photo-1566492031773-4f4e44671857?auto=format&fit=crop&w=150&q=80',
//       level: 99,
//       bio: 'Root Administrator of Fess n Curious.',
//       badges: ['ROOT SUPER ADMIN', 'FOUNDER'],
//     },
//   });

//   // 2. Create Base Admin
//   const baseAdmin = await prisma.user.upsert({
//     where: { handle: '@code_mod' },
//     update: {},
//     create: {
//       id: 'usr_base_mod',
//       username: 'BaseModerator_Code',
//       handle: '@code_mod',
//       email: 'admin@codememfess.id',
//       password: defaultPassword,
//       role: 'Base Admin',
//       avatar:
//         'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=150&q=80',
//       level: 28,
//       bio: 'Official moderator for @codememfess base.',
//       badges: ['BASE MODERATOR', 'VERIFIED ADMIN'],
//       igAccount: '@codememfess_ig',
//       balance: 24580,
//       revenue: 1120000,
//     },
//   });

//   // 3. Create Regular User
//   const regularUser = await prisma.user.upsert({
//     where: { handle: '@anon_shadow' },
//     update: {},
//     create: {
//       id: 'usr_anon_99',
//       username: 'Anon_ShadowX',
//       handle: '@anon_shadow',
//       email: 'anon@fessncurious.app',
//       password: defaultPassword,
//       role: 'User',
//       avatar:
//         'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80',
//       level: 14,
//       bio: 'Secret sender & casual reader.',
//       badges: ['ANON SENDER', 'MEMBER'],
//     },
//   });

//   // 4. Create Bases
//   const basesData = [
//     {
//       id: 'base_001',
//       name: 'Code & Memes Base',
//       handle: '@codememfess',
//       category: 'Hobi',
//       color: '#0055FF',
//       keyword: '[code]',
//       avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=150&q=80',
//       initial: 'CM',
//       bio: 'Base resmi komunitas @codememfess. Kirim confession anonim seputar programming, debugging, dan meme tech!',
//       rules: ['Dilarang SARA & doxxing', 'Gunakan keyword [code]', 'No spam / iklan pinjol'],
//       igAccount: '@codememfess_ig',
//       verified: true,
//       membersCount: 18420,
//       creatorId: baseAdmin.id,
//     },
//     {
//       id: 'base_002',
//       name: 'Unair Menfess',
//       handle: '@unermenfess',
//       category: 'Kampus',
//       color: '#0038FF',
//       keyword: '[unair]',
//       initial: 'UM',
//       bio: 'Confession base ksatria airlangga.',
//       rules: ['Tetap jaga etika berkampus'],
//       verified: true,
//       membersCount: 12400,
//       creatorId: baseAdmin.id,
//     },
//     {
//       id: 'base_003',
//       name: 'ITS Fess',
//       handle: '@fess10nopember',
//       category: 'Kampus',
//       color: '#FF0055',
//       keyword: '[its]',
//       initial: 'ITS',
//       bio: 'Pojok confession mahasiswa ITS Surabaya.',
//       rules: ['Vivat Sepuluh Nopember!'],
//       verified: true,
//       membersCount: 8900,
//     },
//     {
//       id: 'base_004',
//       name: 'UGM Fess',
//       handle: '@fessugm',
//       category: 'Kampus',
//       color: '#FF6D00',
//       keyword: '[ugm]',
//       initial: 'UGM',
//       bio: 'Base mahasiswa Universitas Gadjah Mada Yogyakarta.',
//       verified: true,
//       membersCount: 21300,
//     },
//     {
//       id: 'base_005',
//       name: 'Curhat Surabaya',
//       handle: '@surabayafess',
//       category: 'Kota',
//       color: '#00C853',
//       keyword: '[sby]',
//       initial: 'CS',
//       bio: 'Tongkrongan arek-arek Suroboyo.',
//       verified: false,
//       membersCount: 9700,
//     },
//   ];

//   for (const b of basesData) {
//     await prisma.base.upsert({
//       where: { handle: b.handle },
//       update: {},
//       create: b,
//     });
//   }

//   // 5. Connect platform for @codememfess Base Admin
//   await prisma.platformConnection.upsert({
//     where: {
//       userId_platform: {
//         userId: baseAdmin.id,
//         platform: 'instagram',
//       },
//     },
//     update: {},
//     create: {
//       userId: baseAdmin.id,
//       baseId: 'base_001',
//       platform: 'instagram',
//       name: 'Instagram Graph API (Canvas Story)',
//       status: 'connected',
//       connected: true,
//       accountHandle: '@codememfess_ig',
//     },
//   });

//   // 6. Follow bases for regular user
//   await prisma.follow.upsert({
//     where: {
//       userId_baseId: {
//         userId: regularUser.id,
//         baseId: 'base_001',
//       },
//     },
//     update: {},
//     create: {
//       userId: regularUser.id,
//       baseId: 'base_001',
//     },
//   });

//   // 7. Seed sample confessions
//   const fess1 = await prisma.fess.upsert({
//     where: { id: 'fess_101' },
//     update: {},
//     create: {
//       id: 'fess_101',
//       baseHandle: '@codememfess',
//       baseId: 'base_001',
//       userId: regularUser.id,
//       content: '[code] Kenapa ya setiap kali mau tidur tiba-tiba nemu solusi bug yang udah dicari seharian di kantor? Giliran besok paginya dibuka lagi malah bingung sendiri kenapa kodenya jalan 😭',
//       status: 'published',
//       upvotes: 42,
//       downvotes: 2,
//       commentsCount: 2,
//       topic: 'coding',
//       template: 'default',
//       tag: 'Cerita',
//       postedToIg: true,
//       song: {
//         id: 'id-pop-3',
//         title: 'Secukupnya',
//         artist: 'Hindia',
//         cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300',
//         preview_url: '',
//       },
//     },
//   });

//   // Comments for fess 1
//   await prisma.comment.upsert({
//     where: { id: 'c_101_1' },
//     update: {},
//     create: {
//       id: 'c_101_1',
//       fessId: fess1.id,
//       userId: superAdmin.id,
//       author: 'Anon_Ninja',
//       text: 'Relate banget wkwkwk otak developer emang baru compiling pas rebahan!',
//     },
//   });

//   await prisma.comment.upsert({
//     where: { id: 'c_101_2' },
//     update: {},
//     create: {
//       id: 'c_101_2',
//       fessId: fess1.id,
//       userId: baseAdmin.id,
//       author: 'Anon_Hacker',
//       text: 'Saran gue catet di notes hp sebelum tidur biar besoknya ga lupa logikanya.',
//     },
//   });

//   // Pending confession for moderation queue
//   await prisma.fess.upsert({
//     where: { id: 'fess_pending_01' },
//     update: {},
//     create: {
//       id: 'fess_pending_01',
//       baseHandle: '@codememfess',
//       baseId: 'base_001',
//       userId: regularUser.id,
//       content: '[code] Tanya dong senior-senior di sini, lebih worth it belajar TypeScript dulu apa langsung gas Next.js fullstack buat fresh graduate?',
//       status: 'pending',
//       topic: 'coding',
//       template: 'midnight',
//       tag: 'Tanya',
//     },
//   });

//   // 8. Seed Topics
//   for (const topic of TOPICS) {
//     await prisma.topic.upsert({
//       where: { id: topic.id },
//       update: {},
//       create: {
//         id: topic.id,
//         label: topic.label,
//         category: topic.category,
//         color: topic.color,
//       },
//     });
//   }

//   // 9. Seed Songs
//   for (const song of SONGS) {
//     await prisma.song.upsert({
//       where: { id: song.id },
//       update: {},
//       create: {
//         id: song.id,
//         title: song.title,
//         artist: song.artist,
//         cover: song.cover,
//         previewUrl: song.previewUrl,
//         duration: song.duration,
//         genre: song.genre,
//         popularity: song.popularity,
//       },
//     });
//   }

//   // 10. Seed System Logs
//   await prisma.systemLog.create({
//     data: {
//       source: 'AUTO_BASE',
//       message: 'Sistem Fess n Curious Backend berhasil diinisialisasi.',
//       tone: 'ok',
//     },
//   });

//   console.log('✅ Seeding completed successfully!');
// }

// main()
//   .catch((e) => {
//     console.error('Error during seeding:', e);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });
