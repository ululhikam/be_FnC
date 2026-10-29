# Audit Keamanan Fess n Curious

Status: **audit selesai; perbaikan Tahap 0 + SEC-01, SEC-11, SEC-20 sudah diterapkan** di
branch `fix/security-hardening` (29 Okt 2026). Sisa item terbuka dilacak di checklist §7.
Dokumen ini menjadi acuan tunggal temuan keamanan backend + frontend, dampaknya, dan
urutan perbaikannya. Setiap temuan punya ID stabil (`SEC-xx`) supaya bisa dirujuk dari
commit, PR, dan issue.

Cakupan kode: `backend/src/**`, `backend/prisma/schema.prisma`, `backend/prisma/seed.ts`,
`backend/vercel.json`, `frontend/src/**`, `frontend/index.html`, `frontend/vercel.json`,
higiene secret & git.

> Nomor baris merujuk kondisi kode saat audit (29 Okt 2026). Kalau kode bergeser,
> cari nama fungsi/simbol yang disebut, bukan hanya nomornya.

---

## 1. Ringkasan eksekutif

Fondasi backend tergolong matang: seluruh input divalidasi Zod, `helmet` + CORS whitelist
ketat, Prisma parameterized, wallet CTF memakai conditional update + idempotency key,
payload internal Instagram ditandatangani HMAC dengan benar, dan otorisasi aksi
approve/reject/ban/payout sudah memeriksa `managedBases`/`creatorId`.

Risiko terkonsentrasi pada **empat area**:

| Area | Masalah inti | Temuan |
| --- | --- | --- |
| OAuth Instagram | `state` tidak ditandatangani, callback menerbitkan sesi untuk `userId` dari state | SEC-01 |
| Konfigurasi & identitas | `JWT_SECRET` punya fallback hardcoded; email semua user bocor di endpoint publik | SEC-02, SEC-03 |
| Kontrol laju | `trust proxy` tidak diset → limiter per-IP di Vercel memblokir/meloloskan semua orang sekaligus | SEC-07, SEC-08 |
| Visibilitas konten | Filter status hanya berlaku pada sebagian query → antrean moderasi & konten take-down bisa dibaca publik | SEC-04, SEC-05 |

Tiga temuan **Kritis** (SEC-01..SEC-03) dapat dieksploitasi tanpa kredensial dan berujung
pada takeover akun Super Admin, pemalsuan token, atau kebocoran identitas massal. Ketiganya
layak diperbaiki sebelum perubahan fitur berikutnya.

### Papan skor

| Tingkat | Jumlah | ID |
| --- | --- | --- |
| Kritis | 3 | SEC-01, SEC-02, SEC-03 |
| Tinggi | 9 | SEC-04 … SEC-12 |
| Sedang | 16 | SEC-13 … SEC-28 |
| Rendah | 9 | SEC-29 … SEC-37 |

---

## 2. Tabel temuan

Tingkat: **K** = Kritis, **T** = Tinggi, **S** = Sedang, **R** = Rendah.
Status perbaikan per temuan dilacak di checklist §7.

| ID | Tk | Temuan | Lokasi utama |
| --- | --- | --- | --- |
| SEC-01 | K | OAuth Instagram: `state` tidak bertanda tangan → takeover akun apa pun | `routes/auth.routes.ts`, `services/instagram.service.ts` |
| SEC-02 | K | `JWT_SECRET` fallback hardcoded, tidak fail-fast saat boot | `config/env.ts` |
| SEC-03 | K | Email/balance/revenue semua user bocor di `GET /users/:userId` | `services/user.service.ts`, `services/auth.service.ts` |
| SEC-04 | T | Feed & daftar fess per base mengembalikan `pending`/`rejected` | `services/fess.service.ts`, `validators/*` |
| SEC-05 | T | Detail fess `pending`/`rejected` bisa dibuka siapa pun | `services/fess.service.ts` |
| SEC-06 | T | Upload & signed upload anonim ke bucket publik | `routes/upload.routes.ts` |
| SEC-07 | T | `trust proxy` tidak diset → rate limit per-IP tidak berfungsi | `app.ts`, `middlewares/rateLimit.middleware.ts` |
| SEC-08 | T | Login tanpa lockout, enumerasi akun, OTP tanpa kuota, verifikasi IG via handle | `services/auth.service.ts`, `services/instagram.service.ts` |
| SEC-09 | T | Webhook Midtrans: signature tidak mengikat status → replay settlement | `services/midtrans.service.ts`, `services/payment.service.ts` |
| SEC-10 | T | Token sesi di query URL + tidak ada CSP/Referrer-Policy | `frontend/src/router/index.js`, `views/*`, `index.html`, `vercel.json` |
| SEC-11 | T | IDOR lintas-tenant pada antrean moderasi (`?base=`) | `controllers/admin.controller.ts`, `services/admin.service.ts` |
| SEC-12 | T | Ekonomi billing bisa diarbitrase (kupon, kuota bocor, kill switch, chargeback, welcome bonus) | `services/payment.service.ts`, `coupon.service.ts`, `base-revenue.service.ts` |
| SEC-13 | S | Logout no-op, JWT stateless, reset sandi tidak mencabut sesi | `controllers/auth.controller.ts` |
| SEC-14 | S | Seed membuat Super Admin bersandi `password123`; script seed non-`:dev` memakai `.env` produksi | `prisma/seed.ts`, `package.json` |
| SEC-15 | S | `errorHandler` mengirim `err.message` mentah untuk 500 | `middlewares/error.middleware.ts` |
| SEC-16 | S | `morgan('dev')` aktif di produksi; URL OAuth memuat `?token=` | `app.ts` |
| SEC-17 | S | Webhook Instagram me-log seluruh body | `routes/auth.routes.ts` |
| SEC-18 | S | `flag_reason`, `auto_flagged`, `banned_words` ikut di respons publik | `services/fess.service.ts`, `base.service.ts` |
| SEC-19 | S | Komentar & vote diterima untuk fess yang belum/tidak terbit | `services/comment.service.ts`, `services/fess.service.ts` |
| SEC-20 | S | `POST /fesses/:id/report` memakai `fess_id` dari body, bukan `:id` | `controllers/fess.controller.ts` |
| SEC-21 | S | `POST /fesses/canvas/preview` publik & CPU-bound | `routes/fess.routes.ts` |
| SEC-22 | S | Posting anonim tanpa kuota; user ter-ban tetap bisa posting | `routes/fess.routes.ts`, `middlewares/auth.middleware.ts` |
| SEC-23 | S | `quoted_fess` diterima mentah dari klien (pemalsuan kutipan) | `validators/fess.validator.ts` |
| SEC-24 | S | `GET /templates/:key` tanpa `base_handle` membocorkan template base lain | `services/template.service.ts` |
| SEC-25 | S | Guard SSRF hanya cek literal IP, tanpa resolusi DNS | `utils/remote-image.util.ts` |
| SEC-26 | S | `page` tanpa batas atas & `query` tanpa batas panjang | `services/fess.service.ts` |
| SEC-27 | S | `/payments/reconcile` pakai shared secret statis, tanpa audit | `controllers/payment.controller.ts` |
| SEC-28 | S | Draf confession & token di `localStorage` tanpa enkripsi/expiry | `frontend/src/views/CreateFessPage.vue` |
| SEC-29 | R | `:href` dari data API tanpa filter protokol | `components/common/FessCard.vue`, `admin/InstagramAnalytics.vue` |
| SEC-30 | R | `target="_blank"` tanpa `rel="noopener"` | `components/common/FessCard.vue` |
| SEC-31 | R | Email di query string halaman verifikasi | `frontend/src/utils/emailVerification.js` |
| SEC-32 | R | Perbandingan OTP memakai `!==`, bukan timing-safe | `services/auth.service.ts` |
| SEC-33 | R | `GET /fesses/:id/instagram-status` publik | `services/fess.service.ts` |
| SEC-34 | R | `membersCount` base bisa negatif | `services/base.service.ts` |
| SEC-35 | R | Tidak ada endpoint hapus/edit komentar | `routes/fess.routes.ts` |
| SEC-36 | R | `mark_paid` men-`decrement` `reservedIdr` tanpa guard `gte` | `services/base-revenue.service.ts` |
| SEC-37 | R | Artefak lokal (`tmp-*.mjs`, `backend-dev.log`) tidak di-ignore | `.gitignore` |

---

## 3. Detail temuan kritis & tinggi

### SEC-01 — OAuth Instagram: `state` tidak bertanda tangan → takeover akun apa pun

**Tingkat:** Kritis · **Area:** autentikasi

`backend/src/routes/auth.routes.ts:139-148`

```ts
const statePayload = Buffer.from(
  JSON.stringify({ userId, baseHandle: req.query.base || '', origin })
).toString('base64url');
```

`state` hanya base64 JSON — tidak ada HMAC, tidak ada nonce, tidak ada `exp`. Callback
mempercayainya mentah-mentah (`auth.routes.ts:185`):

```ts
let targetUserId = stateData.userId;
```

Lalu menautkan akun dan **menerbitkan JWT untuk user tersebut** (`auth.routes.ts:315-340`):

```ts
const result = await InstagramService.verifyAndLinkAccount(targetUserId, { code, ... });
const freshToken = generateToken({ sub: activeUser.id, role: activeUser.role, ... });
return res.redirect(`${ENV.FRONTEND_URL}/login?instagram=1&...&token=${freshToken}`);
```

`verifyAndLinkAccount` melakukan `prisma.user.update({ where: { id: userId } })` tanpa
memeriksa role atau kepemilikan (`services/instagram.service.ts:1112-1118`), dan menulis
`Base.igAccount` berdasarkan `baseHandle` dari state tanpa cek kepemilikan
(`instagram.service.ts:1156-1160`).

**Skenario serangan (tanpa akun sama sekali):**

1. Penyerang membuka URL `instagram.com/oauth/authorize` dengan `client_id` publik milik
   aplikasi, `redirect_uri` resmi, dan `state=base64url({"userId":"<id korban>"})`.
2. Login memakai akun Instagram miliknya sendiri → callback menerima `code` valid.
3. Server meng-update user korban, menautkan IG penyerang, lalu mengirim JWT korban di
   query string. Penyerang membaca token itu di browsernya sendiri.

**Dampak:** takeover penuh akun apa pun — termasuk **Super Admin** (approve payout, ubah
paket CTF, ban user) dan penimpaan `igAccount` base milik tenant lain.

**Perbaikan:**

- `state` = JWT/HMAC bertanda tangan berisi `{ userId, baseHandle, origin, nonce, exp: ±10 menit }`,
  nonce disimpan sekali pakai (DB atau cache) dan dihapus saat callback.
- Untuk alur "hubungkan akun", **jangan** pakai `userId` dari state sebagai sumber
  identitas: wajibkan sesi login (`requireAuth`) dan ambil user dari `req.user`.
- Tolak `baseHandle` yang tidak ada di `req.user.managedBases` sebelum menulis ke `Base`.
- Tolak `state` yang tidak valid dengan redirect error, bukan melanjutkan sebagai
  "login Instagram" (`stateData.userId` kosong = alur login; jangan biarkan alur login
  dipicu oleh state buatan penyerang).

---

### SEC-02 — `JWT_SECRET` punya fallback hardcoded

**Tingkat:** Kritis · **Area:** konfigurasi

`backend/src/config/env.ts:67`

```ts
JWT_SECRET: process.env.JWT_SECRET || 'fess_secret_jwt_key_2026',
```

Tidak ada assertion startup yang mewajibkan `JWT_SECRET`. Jika env tidak terpasang (salah
konfigurasi Vercel, preview deployment, environment baru), server tetap boot dengan secret
yang tertulis di repo publik.

**Dampak:** penyerang menandatangani `{ sub: <id Super Admin>, role: 'Super Admin' }`.
`requireAuth` memang me-re-read DB (`middlewares/auth.middleware.ts:158`), tetapi `user.id`
bukan rahasia — muncul di `creator_id` base, respons publik, dan log. Hasilnya: akses penuh
ke konsol Super Admin (approve payout, ubah `PaymentPackage`, buat kupon 99%, `setKyc`).

**Perbaikan:** hapus fallback; `throw` saat boot bila kosong atau `< 32` karakter (kecuali
`NODE_ENV === 'test'`). Rotasi `JWT_SECRET` produksi karena nilai lamanya sudah ada di repo
(dan di riwayat git).

---

### SEC-03 — Email seluruh pengguna bocor di endpoint publik

**Tingkat:** Kritis · **Area:** privasi / identitas

`backend/src/services/user.service.ts:18-33` → `backend/src/services/auth.service.ts:942-946`,
route `backend/src/routes/user.routes.ts:28` (`optionalAuth`, bukan `requireAuth`).

```ts
// user.service.ts:33
return { user: AuthService.serializeUser(user, { includeHandleCooldown: false }) };
// auth.service.ts:942-959
return {
  ...
  email: user.email,
  ...
  balance: user.ctfWallet?.balance ?? user.balance ?? 0,
  revenue: user.revenue ?? 0,
};
```

`GET /api/users/:userId` tanpa login mengembalikan **email**, `balance`, dan `revenue`.
Pada platform yang menjual anonimitas, ini kebocoran identitas massal: `userId` tersedia
dari komentar, daftar follower, dan notifikasi kutipan.

`getProfile` juga memakai `include` penuh (tanpa `select`), sehingga hash password dan
`googleId` ikut termuat ke memori — bertentangan dengan konvensi `AUTH_USER_SELECT`.

**Dampak:** enumerasi email seluruh basis pengguna (bahan phishing & credential stuffing,
karena email adalah identifier login di `auth.service.ts:42-57`), plus kebocoran metrik
finansial per user.

**Perbaikan:**

- Buat serializer profil publik terpisah (whitelist: `id`, `username`, `handle`, `avatar`,
  `bio`, `level`, `badges`, `managed_bases`, counter sosial, `created_at`).
- Kirim `email`/`balance`/`revenue` hanya bila `req.user.id === userId` atau pemanggil
  Super Admin.
- Ganti `include` menjadi `select` eksplisit.

---

### SEC-04 — Feed & daftar fess per base mengembalikan `pending`/`rejected`

**Tingkat:** Tinggi · **Area:** visibilitas konten

`backend/src/services/fess.service.ts:92-98`

```ts
if (params.status) {
  where.status = params.status === 'approved' ? { in: ['published', 'approved'] } : params.status;
} else if (!params.base) {
  where.status = { in: ['published', 'approved'] };   // hanya bila TANPA base
}
```

Tiga celah sekaligus:

1. `GET /api/fesses?base=@x` → tanpa filter status (default `params.base` terisi → cabang
   `else if` dilewati).
2. `GET /api/bases/@x/fesses` (`routes/base.routes.ts:25`) → default sudah membocorkan
   antrean moderasi.
3. `validators/fess.validator.ts:112` dan `validators/base.validator.ts:59` mengizinkan
   `pending|rejected` untuk pengunjung anonim → `GET /api/fesses?status=pending` = antrean
   moderasi **seluruh platform**.

Cache 15 detik (`fess.service.ts:131-136`) tidak memasukkan identitas viewer ke key,
sehingga hasil non-publik bisa tersaji ke pengunjung lain.

**Dampak:** moderasi base tidak menegakkan apa pun; konten yang ditolak, kena filter NLP,
atau mengandung data pribadi dapat dibaca publik dan dipanen.

**Perbaikan:** default `published` **selalu**; `pending/rejected` hanya untuk Base Admin
yang mengelola base tersebut (dan `reported=true` hanya untuk mereka); masukkan viewer ke
cache key atau jangan cache query non-publik.

---

### SEC-05 — Detail fess `pending`/`rejected` bisa dibuka siapa pun

**Tingkat:** Tinggi · **Area:** visibilitas konten

`backend/src/services/fess.service.ts:559-609`, route `routes/fess.routes.ts:35`
(`optionalAuth`). `findUnique({ where: { id } })` tanpa pemeriksaan `status` sama sekali,
lalu `serializeFess` mengembalikan konten + komentar.

**Dampak:** take-down tidak efektif (link lama tetap hidup), antrean moderasi bisa
dienumerasi, diskusi pada konten non-terbit ikut terbaca.

**Perbaikan:** bila `status` bukan `published|approved`, kembalikan 404 kecuali viewer adalah
penulis, Base Admin pengelola, atau Super Admin.

---

### SEC-06 — Upload & signed upload anonim ke bucket publik

**Tingkat:** Tinggi · **Area:** abuse / biaya

`backend/src/routes/upload.routes.ts:8-10` — ketiga route memakai `optionalAuth`, dan
controller tidak memeriksa `req.user` (`controllers/upload.controller.ts`).

```ts
router.post('/', optionalAuth, uploadSingleMedia, UploadController.uploadMedia);
router.post('/sign', optionalAuth, UploadController.signMediaUpload);
router.post('/avatar', optionalAuth, uploadSingleMedia, UploadController.uploadAvatar);
```

Validasi hanya `file.mimetype` dari klien (`middlewares/upload.middleware.ts:10-16`), tanpa
pemeriksaan magic bytes.

**Dampak:** platform menjadi file-hosting anonim gratis (biaya storage/egress Supabase),
vektor hosting konten ilegal di domain Anda, dan penyalahgunaan nama brand. `/upload/sign`
tidak membatasi jumlah URL yang diminta.

**Perbaikan:** wajib `requireAuth` + `requireVerifiedEmail`; kuota per user/hari (pakai
`RateLimitService`); batas ukuran & content-type pada signed URL; validasi magic bytes
(`file-type`); pertimbangkan bucket privat + URL bertanda tangan untuk media non-publik.

---

### SEC-07 — `trust proxy` tidak diset → rate limit per-IP tidak berfungsi

**Tingkat:** Tinggi · **Area:** kontrol laju

`backend/src/app.ts` tidak memanggil `app.set('trust proxy', ...)`, sementara limiter
memakai `req.ip` (`middlewares/rateLimit.middleware.ts:27`):

```ts
const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
```

Di Vercel, `req.ip` adalah alamat socket proxy — praktis sama untuk semua pengguna.

**Dampak:**

- Bucket global 60 req/menit dibagi seluruh dunia → satu aktor bisa memblokir layanan untuk
  semua orang (DoS murah), dan aktor lain tidak pernah terkena batasnya sendiri.
- `paymentRateLimit` (`services/rate-limit.service.ts:80-82`) memakai `req.ip` sebagai key →
  limit "5 order/menit" dan "20 review payout/menit" berlaku **global**, bukan per penyerang.
  Kontrol anti-abuse pembayaran tidak berfungsi sekaligus berisiko mengganggu operasi normal.
- Limiter in-memory juga per-instance serverless (sudah dicatat di AGENTS.md).

**Perbaikan:** `app.set('trust proxy', 1)`; pindahkan limiter sensitif (login, OTP, upload,
create fess, canvas preview) ke `RateLimitService` (Postgres) dengan key per user **dan**
per IP.

---

### SEC-08 — Login tanpa lockout, enumerasi akun, OTP tanpa kuota, verifikasi IG via handle

**Tingkat:** Tinggi · **Area:** autentikasi

- **Enumerasi akun:** pesan berbeda untuk user tidak ditemukan vs sandi salah
  (`services/auth.service.ts:59-63` vs `:81-86`); `banReason` ikut dibocorkan
  (`:66-71`).
- **Tanpa lockout:** `/auth/login` (`routes/auth.routes.ts:44`) hanya mengandalkan limiter
  global yang rusak (SEC-07) → brute force password tanpa batas, termasuk akun Super Admin.
- **OTP reset tanpa kuota:** `forgotPassword` (`auth.service.ts:769-811`) tidak punya
  cooldown maupun limit per email/IP, dan **me-reset `attempts` ke 0** setiap permintaan
  (`:786-792`). OTP 6 digit jadi bisa di-brute-force tanpa batas percobaan total, plus
  email bombing ke korban.
- **Verifikasi Instagram palsu:** `verifyAndLinkAccount` menerima `handle` dan langsung
  menetapkan `verified: true` tanpa memanggil Meta (`instagram.service.ts:1083-1092`).

**Perbaikan:** pesan login seragam + lockout per akun (mis. 5 gagal → jeda 15 menit) dengan
counter di Postgres; cooldown `forgotPassword` 60 detik + kuota harian per email/IP; hitung
percobaan OTP lintas permintaan (jangan reset `attempts` saat kirim ulang); hapus jalur
`handle` pada verifikasi Instagram.

---

### SEC-09 — Webhook Midtrans: signature tidak mengikat status transaksi

**Tingkat:** Tinggi · **Area:** pembayaran

`backend/src/services/midtrans.service.ts:272-289` — signature Midtrans adalah
`SHA512(order_id + status_code + gross_amount + server_key)`; **`transaction_status` dan
`fraud_status` tidak termasuk**. `handleNotification` langsung memutuskan kredit dari body
tanpa memanggil Status API (`services/payment.service.ts:583-597`):

```ts
if (transactionStatus === 'settlement' ||
   (transactionStatus === 'capture' && fraudStatus === 'accept')) {
  return this.settleOrder(order, payload, data);
```

`PaymentEvent.payload` menyimpan `signature_key` mentah (`payment.service.ts:390`), dan
`eventKey` ikut memasukkan signature (`:113-128`) sehingga payload modifikasi tidak
ter-dedup dengan notifikasi asli.

**Dampak:** siapa pun yang pernah melihat satu payload bertanda tangan valid untuk sebuah
order (backup DB, ekspor admin, log) dapat me-replay-nya dengan
`transaction_status: "settlement"` → CTF terkredit tanpa uang masuk (625 CTF per paket
Rp100.000). Ini juga menurunkan nilai audit trail: `PaymentEvent` tidak membuktikan apa pun
tentang status sebenarnya.

**Perbaikan:** sebelum `settleOrder`, panggil `MidtransService.getStatus(orderId)` dan pakai
status dari API; tolak settlement bila `status_code !== '200'`; strip `signature_key` sebelum
menyimpan `PaymentEvent`.

---

### SEC-10 — Token sesi di query URL + tidak ada CSP/Referrer-Policy

**Tingkat:** Tinggi · **Area:** frontend / sesi

- **Ingest token di semua route** — `frontend/src/router/index.js:221-228`:
  ```js
  if (to.query.token && typeof to.query.token === 'string') {
    await authStore.loginWithToken(to.query.token);
  }
  ```
  Penyerang cukup mengirim `/feed?token=<JWT penyerang>` ke korban: korban login sebagai
  penyerang dan menulis confession/aksi ke akun penyerang (login CSRF / session fixation).
- **Token tidak dibersihkan** — `views/LoginPage.vue:315-331` hanya `router.replace` di
  cabang error; jalur sukses memakai `router.push`, sehingga `?token=` tetap di history.
- **Injeksi token tanpa validasi** — `views/BaseAdminDashboard.vue:529-535` dan
  `views/BaseOnboardingPage.vue:573-580` menulis token mentah ke `localStorage`; di dashboard
  `authStore.fetchCurrentUser?.()` tidak ada (namanya `fetchMe`) sehingga validasi senyap
  gagal.
- **Tanpa header keamanan** — `frontend/index.html` & `frontend/vercel.json` tidak punya CSP,
  `Referrer-Policy`, `X-Frame-Options`/`frame-ancestors`, atau HSTS → clickjacking pada konsol
  admin (tombol payout) dan URL ber-`token`/`email` bocor via `Referer`.
- **JWT di `localStorage`** — `stores/authStore.js:19,79,110`, umur 1 hari, tanpa mitigasi
  berlapis. Tidak ada `v-html`/`innerHTML`/`eval` di frontend (sudah diverifikasi), jadi ini
  risiko berlapis, bukan celah langsung.

**Perbaikan:** terima `?token=` hanya di route `/login` dan `/onboarding/base`, validasi
`exp` sebelum menyimpan, langsung `history.replaceState` untuk menghapusnya; tambahkan
header keamanan di `frontend/vercel.json`; jangka panjang pindah ke cookie
`HttpOnly; Secure; SameSite=Lax` (client sudah mengirim `credentials: 'include'`).

---

### SEC-11 — IDOR lintas-tenant pada antrean moderasi

**Tingkat:** Tinggi · **Area:** otorisasi

`backend/src/controllers/admin.controller.ts:36-40` + `backend/src/services/admin.service.ts:197-201`:

```ts
const base = req.query.base as string;
...
if (baseHandle) { where.baseHandle = baseHandle; }              // menimpa filter kepemilikan
else if (!isSuperAdmin && currentUser.managedBases?.length) {
  where.baseHandle = { in: currentUser.managedBases };
}
```

`ModerationQueueQuerySchema` (`validators/admin.validator.ts:283-287`) menerima `base` bebas.

**Dampak:** Base Admin base A dapat membaca seluruh fess pending **dan komentar** base B hanya
dengan mengganti query string.

**Perbaikan:** tolak `baseHandle` yang tidak ada di `req.user.managedBases` (403), atau
selalu `intersect` dengan daftar base yang dikelola.

---

### SEC-12 — Ekonomi billing bisa diarbitrase

**Tingkat:** Tinggi · **Area:** pembayaran / revenue

Yang **sudah** benar: nominal selalu dari DB (`PaymentPackage`), `gross_amount` dibandingkan
dengan `order.amountIdr`, settlement memakai claim `updateMany` + idempotency key
`topup:{orderId}` sehingga tidak bisa dobel, debit wallet memakai `balance >= amount`.

Masalah yang tersisa:

1. **Arbitrase kupon ↔ revenue.** Diskon menurunkan harga bayar tetapi **tidak** menurunkan
   `ctfAmount`, sementara revenue base tetap `BASE_REVENUE_PER_FESS_IDR = 80`
   (`constants/payments.ts:8`). Lantai harga hanya `MIN_CHARGEABLE_IDR = 1_000`
   (`utils/coupon.util.ts:121-137`). Kupon potongan Rp99.000 pada paket Rp100.000/625 CTF →
   bayar Rp1.000, klaim revenue Rp50.000 → profit ±Rp49.000 per akun, dapat diulang dengan
   akun lain (`maxPerUser` dihitung per user).
2. **Kuota kupon bocor permanen.** Jalur charge-ditolak (`payment.service.ts:257-279`) dan
   `EXPIRED` (`:625-631`) tidak memanggil `CouponService.release`. Padahal `reserve` sudah
   menaikkan `redemptionCount` dan baris `RESERVED` dihitung pada `maxPerUser`
   (`coupon.service.ts:299-310`). Akibatnya: kuota promo terbakar oleh order tak dibayar, dan
   user yang gagal bayar tidak bisa memakai kuponnya lagi.
3. **Kill switch tidak menyeluruh.** `PAYMENTS_ENABLED` hanya dicek di `createOrder`
   (`payment.service.ts:144`); webhook, `syncOrder`, dan `/payments/reconcile` tetap dapat
   mengubah order → PAID dan mengkredit CTF saat flag `false`. Rem darurat tidak berfungsi
   saat insiden.
4. **Chargeback tidak mendebit CTF** (`payment.service.ts:633-686`): order jadi `CHARGEBACK`,
   CTF tetap di tangan pengguna dan mungkin sudah terpakai.
5. **Welcome bonus 1 CTF/akun** (`welcome-bonus.service.ts:19-41`) + registrasi base
   self-service = farming revenue Rp80 per akun disposable (625 akun ≈ Rp50.000, melewati
   `BASE_PAYOUT_MIN_IDR`, dapat diulang tiap siklus hold).
6. **`mark_paid` tanpa guard `gte`** (`base-revenue.service.ts:871-876`):
   ```ts
   if (changed === 1) {
     await tx.baseRevenueWallet.update({
       where: { id: payout.walletId },
       data: { reservedIdr: { decrement: payout.amountIdr } },   // bisa negatif
     });
   }
   ```

**Perbaikan:** release kupon pada `EXPIRED`/charge-ditolak + sapu bersih order lama; ambang
ekonomi minimum `finalAmountIdr / ctfAmount`; hitung revenue base proporsional `amountIdr`;
cek `PAYMENTS_ENABLED` di semua jalur uang atau dokumentasikan eksplisit bahwa webhook
sengaja tetap hidup; debit/clawback CTF untuk chargeback; `updateMany` dengan
`reservedIdr: { gte: amount }` dan gagal keras bila `count !== 1`.

---

## 4. Detail temuan sedang

| ID | Bukti | Dampak | Perbaikan |
| --- | --- | --- | --- |
| SEC-13 | `controllers/auth.controller.ts:46-52` — `logout` hanya membalas `{ ok: true }` | JWT stateless 1 hari; token curian tetap valid setelah korban logout atau mengganti sandi | Tambah `tokenVersion`/`sessionInvalidBefore` di `User`, naikkan saat logout & reset sandi, cek di `requireAuth` |
| SEC-14 | `prisma/seed.ts` — `defaultPassword = bcrypt.hash('password123')`, Super Admin `superadmin@fessncurious.app`; script seed tanpa `:dev` membaca `.env` produksi | Bila seed dijalankan di produksi → akun root bersandi publik | Hapus akun seed dari jalur produksi; wajibkan `SEED_ADMIN_PASSWORD` dari env; guard `NODE_ENV` |
| SEC-15 | `middlewares/error.middleware.ts:10-18` — `message = err.message` untuk semua status | Detail internal/Prisma (nama kolom, constraint) bocor ke klien | Pesan generik untuk 5xx; detail hanya ke log |
| SEC-16 | `app.ts:64-66` — `morgan('dev')` saat `NODE_ENV !== 'test'`; URL OAuth Instagram memuat `?token=` | JWT & PII tercatat di log Vercel | Matikan morgan di produksi atau pakai format tanpa query string |
| SEC-17 | `routes/auth.routes.ts:399-401` — `console.log('[Meta Webhook Event Received]:', JSON.stringify(req.body))` | PII/event Meta masuk log | Log ringkas (jenis event + id) |
| SEC-18 | `services/fess.service.ts:1739-1740` (`auto_flagged`, `flag_reason`), `services/base.service.ts:651` (`banned_words`) | Filter moderasi bisa diakali secara iteratif; blacklist base terbuka ke publik | Pindahkan ke respons khusus admin |
| SEC-19 | `services/comment.service.ts:12-27` & `:47-70`; `services/fess.service.ts:724-731`, `:1344-1355` | Komentar/vote pada konten non-terbit; spam notifikasi ke penulis | Wajibkan `status in ('published','approved')` |
| SEC-20 | `controllers/fess.controller.ts:321-322` — `const { fess_id } = req.body; reportFess(fess_id, ...)` | Laporan atas fess yang tak pernah dilihat klien; audit membingungkan | Pakai `req.params.id` sebagai otoritatif |
| SEC-21 | `routes/fess.routes.ts:26-31` — `optionalAuth` + render resvg/sharp (maks 4 media, `with_thumbnail` bisa memicu AI) | DoS CPU/biaya serverless oleh anonim | Wajib login atau limiter Postgres per IP + per user |
| SEC-22 | `routes/fess.routes.ts:24` (`optionalAuth`) + `middlewares/auth.middleware.ts:189-209` | User ter-ban tetap bisa membanjiri base gratis sebagai anonim; tanpa kuota per-user untuk anonim | Kuota per IP untuk anonim; blokir total bila `isBanned` |
| SEC-23 | `validators/fess.validator.ts:40-47` → `services/fess.service.ts:394` (`quotedFess: payload.quoted_fess`) | Pemalsuan kutipan/handle yang dirender di canvas | Verifikasi `id`/`handle` kutipan ke DB |
| SEC-24 | `services/template.service.ts:128-131` — `getActive(key)` tanpa filter `baseId`; `toSummary` menyertakan `base_id` | Enumerasi template eksklusif antar-tenant | Bila key milik base, wajib `base_handle` yang berhak |
| SEC-25 | `utils/remote-image.util.ts:21-62` — hanya cek literal IPv4/IPv6 | DNS rebinding & IPv4-encoded (`2130706433`) bisa lolos | Resolve DNS lalu cek hasil, atau pakai allowlist domain |
| SEC-26 | `services/fess.service.ts:82-102` — `page` tanpa `max`, `query` tanpa `max` | OFFSET raksasa → beban DB dari endpoint publik | `page` `max(1000)`, `query` `max(100)` |
| SEC-27 | `controllers/payment.controller.ts:92-109` — shared secret statis, tanpa audit, tetap aktif saat payments OFF | Replay bila secret bocor; tak ada jejak siapa menjalankan | HMAC + timestamp, catat `AdminAuditLog`, hormati `PAYMENTS_ENABLED` |
| SEC-28 | `views/CreateFessPage.vue:545-556` — `localStorage.setItem('fess_draft', ...)` | Isi confession sensitif tersimpan plaintext tanpa expiry | TTL + tombol hapus; jangan simpan media base64 |

---

## 5. Detail temuan rendah

| ID | Bukti | Perbaikan |
| --- | --- | --- |
| SEC-29 | `components/common/FessCard.vue:545`, `components/admin/InstagramAnalytics.vue:264,298` — `:href` dari API tanpa filter | Pakai helper `safeExternalUrl()` (sudah ada, dipakai di `TopUpFlow.vue:1016-1025`) |
| SEC-30 | `components/common/FessCard.vue:543-548` — `target="_blank"` tanpa `rel` | Tambah `rel="noopener noreferrer"` |
| SEC-31 | `utils/emailVerification.js:53-60` — `query.email = result.email` | Kirim email via fragment atau state di store |
| SEC-32 | `services/auth.service.ts:628, 846` — `sha256(otp) !== record.otpHash` | `crypto.timingSafeEqual` pada buffer hex |
| SEC-33 | `services/fess.service.ts:615-651` — status IG publik | Batasi ke pemilik/base admin |
| SEC-34 | `services/base.service.ts:268-280` — `decrement: 1` tanpa `gt: 0` | `updateMany` dengan `membersCount: { gt: 0 }` |
| SEC-35 | `routes/fess.routes.ts:88-89` — tidak ada DELETE/PATCH komentar | Tambah hapus oleh pemilik & Base Admin (gap moderasi) |
| SEC-36 | `services/base-revenue.service.ts:871-876` | Lihat SEC-12 poin 6 |
| SEC-37 | `.gitignore` backend hanya mengabaikan `tmp_verify_*.ts`; ada `tmp-*.mjs` dan `backend-dev.log` | Abaikan `tmp-*`, `*.log` (sudah ada) dan pastikan file lokal tidak ter-commit |

---

## 6. Yang sudah benar (jangan dirusak saat memperbaiki)

Diverifikasi langsung di kode:

- **Validasi input:** Zod di seluruh body/query/params, dan `validateQuery` menimpa
  `req.query` sehingga key tak dikenal dibuang (`middlewares/validate.middleware.ts`).
- **Transport & CORS:** `helmet` aktif; CORS memakai whitelist `ALLOWED_ORIGINS`, bukan
  wildcard (`app.ts:17-46`).
- **SQL:** Prisma parameterized. `$queryRawUnsafe` di `services/admin.service.ts:110-159`
  tetap memakai placeholder `$n` + `values` (aman).
- **Wallet CTF:** `updateMany where balance >= amount` + idempotency key unik
  (`services/ctf-wallet.service.ts:160-230`) → saldo tidak bisa minus dan tidak dobel.
- **Settlement order:** claim `updateMany` (`status in [PENDING, EXPIRED]`) → PAID, cek
  `gross_amount` vs DB, audit `PAYMENT_AMOUNT_MISMATCH` (`services/payment.service.ts:77-86,
  422-454, 723-771`).
- **Internal worker Instagram:** HMAC timing-safe, cek `exp`, validasi bentuk payload
  (`services/instagram.service.ts:2117-2199`); endpoint `/internal/*` di luar `requireAuth`
  tapi tidak bisa dipakai tanpa tanda tangan.
- **Otorisasi aksi sensitif:** approve/reject/delete fess, laporan, ban, payout memeriksa
  role + `managedBases`/`creatorId`; Super Admin sengaja dikecualikan dari aksi tulis base
  (`requireBaseAdmin`).
- **Seleksi field:** `AUTH_USER_SELECT` mencegah hash password masuk `req.user`;
  `COMMENT_PREVIEW_SELECT`/`BASE_PREVIEW_SELECT` menjaga anonimitas penulis fess.
- **Frontend:** tidak ada `v-html`/`innerHTML`/`eval`/`new Function`; semua HTTP lewat
  `src/api/client.js` dengan penanganan 401 terpusat; `safeRedirect()` menutup open redirect;
  tidak ada secret server-only di bundle.
- **Secret:** `git ls-files` di kedua repo bersih dari `.env` — hanya `*.example` yang
  ter-commit.

---

## 7. Rencana perbaikan

### Tahap 0 — konfigurasi (< 1 jam, tanpa perubahan perilaku besar)

- [x] SEC-02 — hapus fallback `JWT_SECRET`, fail-fast saat boot (min 32 karakter; fallback
      hanya untuk `NODE_ENV=test`). **Rotasi secret produksi masih perlu dilakukan manual.**
- [x] SEC-07 — `app.set('trust proxy', ENV.TRUST_PROXY)`; default 1 hop di Vercel, bisa
      ditimpa env `TRUST_PROXY`
- [x] SEC-06 — `requireAuth` pada ketiga route `/upload`
- [x] SEC-03 — serializer profil publik tanpa `email`/`balance`/`revenue` + `select` eksplisit
- [x] SEC-04, SEC-05 — default `status=published` + cek status di detail fess
- [x] SEC-10 — header keamanan di `frontend/vercel.json` (CSP, `Referrer-Policy: no-referrer`,
      `X-Frame-Options: DENY`, HSTS)
- [x] SEC-15, SEC-16 — pesan error generik untuk 5xx, matikan morgan di produksi

### Tahap 1 — minggu yang sama

- [x] SEC-01 — tandatangani `state` OAuth Instagram (HMAC + exp + nonce), larang penerbitan
      sesi dari `userId` di state, cek kepemilikan `baseHandle`
- [ ] SEC-08 — limiter Postgres untuk login/OTP, pesan login seragam, lockout, cooldown
      `forgotPassword`, hapus verifikasi IG via `handle`
      → verifikasi IG via `handle` **selesai** (jalur dikarang-lokal dihapus, penautan akun
      hanya lewat `instagramId`); limiter/lockout belum
- [x] SEC-11 — validasi `baseHandle` pada `/admin/moderation` terhadap `managedBases`
- [ ] SEC-09 — `getStatus()` Midtrans sebelum settle, strip `signature_key`
- [x] SEC-10 — batasi ingest `?token=` ke route login/onboarding + bersihkan dari URL
- [ ] SEC-19, SEC-20 — wajibkan status terbit untuk komentar/vote; pakai `req.params.id`
      → SEC-20 selesai; SEC-19 belum
- [ ] SEC-18 — pindahkan `flag_reason`/`banned_words`/`auto_flagged` ke respons admin

### Tahap 2 — sebelum fitur uang berikutnya

- [ ] SEC-12 — release kupon pada `EXPIRED`/charge-ditolak, ambang ekonomi
      `finalAmountIdr/ctfAmount`, `PAYMENTS_ENABLED` di semua jalur uang, clawback CTF untuk
      chargeback, guard `gte` pada `reservedIdr`
- [ ] SEC-14 — seed admin dari env, guard produksi
- [ ] SEC-13 — mekanisme pencabutan sesi (`tokenVersion`)
- [ ] SEC-21, SEC-22 — kuota render canvas & posting anonim
- [ ] SEC-24, SEC-25, SEC-26, SEC-27 — isolasi template, DNS-aware SSRF guard, batas
      pagination, hardening reconcile

### Tahap 3 — backlog

Sisanya (SEC-23, SEC-28 … SEC-37) masuk backlog perbaikan rutin.

### 7.1 Status implementasi per temuan (branch `fix/security-hardening`)

| ID | Perubahan | Berkas |
| --- | --- | --- |
| SEC-01 | `state` = `base64url(payload).HMAC-SHA256` dengan `exp` 10 menit + `nonce`; callback menolak state tak valid (`?error=oauth_state_invalid`); penautan `Base.igAccount` wajib `creatorId === userId`; penautan akun login hanya lewat `instagramId` (bukan handle IG) | `utils/oauth-state.util.ts` (baru), `routes/auth.routes.ts`, `services/instagram.service.ts` |
| SEC-02 | Fallback hardcoded dihapus; `JWT_SECRET` < 32 karakter → throw saat boot (kecuali `NODE_ENV=test`) | `config/env.ts` |
| SEC-03 | `serializePublicUser()` + `select` eksplisit; email/balance/revenue tidak lagi di respons publik | `services/auth.service.ts`, `services/user.service.ts` |
| SEC-04 | `canViewUnpublishedFess()`; `?status=` non-terbit → 403 untuk non-pengelola; feed base tanpa status selalu `published/approved`; `reported=true` digerbang; cache hanya query publik | `services/fess.service.ts` |
| SEC-05 | `getFessById` → 404 untuk fess non-terbit kecuali penulis/pengelola base/Super Admin | `services/fess.service.ts` |
| SEC-06 | Ketiga route `/upload` memakai `requireAuth` | `routes/upload.routes.ts` |
| SEC-07 | `app.set('trust proxy', ENV.TRUST_PROXY)` | `app.ts`, `config/env.ts` |
| SEC-08 (sebagian) | Verifikasi IG via `handle` dihapus (`400 INSTAGRAM_OAUTH_REQUIRED`); field `handle` dicabut dari validator | `services/instagram.service.ts`, `validators/auth.validator.ts` |
| SEC-10 | Ingest `?token=` dibatasi ke `Login`/`BaseOnboarding`/`BaseAdmin`, token dibuang dari URL via `replace: true`, redirect per role dipindah ke guard; header CSP/HSTS/`Referrer-Policy`/`X-Frame-Options`/`Permissions-Policy`/COOP di `vercel.json` | `src/router/index.js`, `views/BaseAdminDashboard.vue`, `views/BaseOnboardingPage.vue`, `vercel.json` |
| SEC-11 | `getModerationQueue` menolak `baseHandle` yang tidak dikelola (403) | `services/admin.service.ts` |
| SEC-15 | 5xx di produksi → pesan generik; detail tetap di log | `middlewares/error.middleware.ts` |
| SEC-16 | `morgan` hanya aktif saat `NODE_ENV === 'development'` | `app.ts` |
| SEC-20 | `reportFess` memakai `req.params.id`; `fess_id` di body jadi opsional | `controllers/fess.controller.ts`, `validators/fess.validator.ts` |

---

## 8. Saran pengujian regresi

Test backend memakai Vitest + Supertest dengan Prisma di-mock, jadi temuan di atas bisa
dikunci sebagai test tanpa database:

| Temuan | Test yang disarankan |
| --- | --- |
| SEC-01 | Callback dengan `state` tidak bertanda tangan / `userId` milik user lain → 4xx, tidak ada token di redirect |
| SEC-03 | `GET /users/:id` tanpa auth → tidak memuat `email`/`balance`/`revenue` |
| SEC-04, SEC-05 | `GET /fesses?base=@x`, `GET /fesses?status=pending`, `GET /fesses/:id` (pending) sebagai anonim → tidak mengembalikan konten non-terbit |
| SEC-06 | `POST /upload/sign` tanpa `Authorization` → 401 |
| SEC-07 | `req.ip` di belakang proxy (`X-Forwarded-For`) menghasilkan key limiter berbeda per klien |
| SEC-09 | Notifikasi dengan `transaction_status` dimodifikasi tetapi signature valid → tidak mengkredit CTF |
| SEC-11 | Base Admin base A meminta `?base=@B` → 403 |
| SEC-12 | Order `EXPIRED`/charge-ditolak → `Coupon.redemptionCount` kembali; `PAYMENTS_ENABLED=false` → tidak ada transisi ke PAID |
| SEC-19 | Komentar/vote pada fess `pending` → 4xx |
| SEC-20 | `POST /fesses/<A>/report` dengan body `fess_id=<B>` → laporan tercatat untuk A |

Catatan: `testTimeout` 30 detik di `vitest.config.ts` wajib dipertahankan untuk test canvas
(CPU-bound resvg/sharp).

---

## 9. Catatan proses

- Audit ini statis (membaca kode), bukan pentest dinamis terhadap dev/production.
- Perbaikan Tahap 0 + SEC-01, SEC-11, SEC-20 dikerjakan di branch `fix/security-hardening`
  (backend & frontend), **bukan** `main` (lihat `AGENTS.md`).
- Setelah SEC-01/SEC-02 diperbaiki, sebaiknya jalankan pentest ringan pada alur OAuth
  Instagram dan pembayaran di environment dev.

### 9.1 Keputusan desain saat implementasi

| Topik | Keputusan | Alasan |
| --- | --- | --- |
| `JWT_SECRET` fail-fast | Throw saat import `config/env.ts` bila kosong/<32 karakter, kecuali `NODE_ENV=test` | Modul `env.ts` sudah melempar error untuk kasus `.env.development` hilang; fail-fast saat boot lebih terlihat daripada 401 misterius di runtime. Test tetap bisa jalan tanpa env karena Prisma di-mock |
| `/upload` + verifikasi email | Hanya `requireAuth`, **tanpa** `requireVerifiedEmail` | Alur onboarding base (termasuk akun Instagram tanpa email) butuh unggah avatar sebelum verifikasi; mengunci di sini akan memutus funnel. Risiko anonim sudah hilang karena sesi wajib |
| `?status=` non-terbit | 403 `FORBIDDEN` bila viewer bukan pengelola base, bukan 404 | Endpoint sudah diketahui publik; 404 menyembunyikan konten tetapi menyulitkan debugging admin. Untuk **detail** fess dipakai 404 agar keberadaan konten non-terbit tidak bisa ditebak |
| Cache feed | Cache hanya dipakai untuk query publik (`canViewUnpublished === false`) | Hasil query admin (pending/reported) tidak boleh tersaji ke pengunjung lain lewat key cache yang sama |
| CSP | `script-src 'self' 'unsafe-inline'` + `'wasm-unsafe-eval'`, `worker-src blob:` | `index.html` memuat inline script bootstrap tema dan `ld+json`, jadi hash saja tidak cukup. `'wasm-unsafe-eval'` + `worker-src blob:` diperlukan ffmpeg.wasm (normalisasi video di composer) |
| `frame-ancestors 'none'` + `X-Frame-Options: DENY` | Keduanya dipasang | `frame-ancestors` menangani browser modern, `X-Frame-Options` untuk klien lama |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | Alur OAuth Google/Instagram membuka popup/redirect; `same-origin` penuh bisa memutus `postMessage` |
| Verifikasi Instagram | Jalur "by handle" dihapus; hanya `token`/`code` dari Meta OAuth | Dulu profil `verified: true` dikarang lokal dari string handle, sehingga handle bisa diklaim siapa pun dan binding IG akun lain ikut terlepas (`updateMany` melepas `instagramId` lama) |
| Login Instagram | Penautan akun hanya lewat `instagramId`, bukan kecocokan `handle` | Mencocokkan `handle` FnC dengan username IG = takeover: buat akun IG bernama sama dengan handle korban, login, dapat sesi korban |

### 9.2 Verifikasi

- `npx vitest run` di `backend`: **45 file / 581 test lulus** (termasuk suite baru
  `tests/oauth-state.util.test.ts` dan test regresi SEC-03/04/05/11/20).
- `npm run build` di `backend` dan `frontend`: lulus.
- `npm run format:check` di `frontend` **sudah gagal sebelum perubahan ini** karena
  `core.autocrlf=true` di Windows sementara `.prettierrc.json` menetapkan `endOfLine: "lf"`
  (50 file, termasuk yang tidak tersentuh). Baris baru yang ditambahkan pada perubahan ini
  sudah sesuai Prettier setelah line ending dinormalisasi.
