# CTF + Midtrans — Progress Tracker

Dokumen ini adalah sumber kebenaran tunggal untuk progres fitur **CTF (Coin to Fess), top-up Midtrans, trial base, pendapatan base, dan payout**.

- Repo backend: `ululhikam/be_FnC`
- Repo frontend: `ululhikam/con.fess_WebApp`
- Branch kerja: `feat/ctf-midtrans` (backend & frontend)
- Status: **Fase 2, 3, dan 4 selesai; E2E Midtrans sandbox (QRIS + BCA VA dengan notifikasi asli) selesai; E2E fess berbayar 1 CTF di dev selesai; smoke UI top-up selesai; parser WIB, lifecycle pending/expire, refund QRIS, dan rekonsiliasi manual sudah diverifikasi; idempotensi audit refund/chargeback diperbaiki; welcome bonus 1 CTF dan logo metode pembayaran sudah diverifikasi di dev; UI wallet/top-up dipoles dan diverifikasi di dev; Meta/Instagram berfungsi dan opsional; publikasi FnC-only untuk base tanpa sosmed selesai; sign-off production belum**
- Jangan merge ke `main` atau deploy ke production sampai sign-off eksplisit.

## 1. Keputusan yang sudah dikunci

### Produk

- CTF adalah saldo prabayar internal, integer, tidak bisa ditransfer, dan tidak bisa dicairkan.
- **1 fess = 1 CTF** setelah trial base berakhir.
- Base baru mendapat trial **7 hari sejak base dibuat**.
- Selama trial, semua fess di base tersebut gratis.
- Base lama mendapat **grace 7 hari sejak fitur diaktifkan**.
- Trial dibatasi **satu kali per creator** untuk mencegah abuse.
- User yang memposting membayar, termasuk base owner.
- Base boleh mendapat bagi hasil, tetapi dalam **IDR**, bukan CTF.
- Base revenue default: **Rp80 per fess berbayar yang terbit**.
- Self-post oleh creator/admin base **tidak menghasilkan revenue base**.
- Base revenue memiliki holding **7 hari** sebelum available.
- Payout base minimal **Rp50.000**, manual, dengan approval Super Admin.
- Biaya transfer payout default **Rp6.500**, dapat disesuaikan saat approval.
- Super Admin dapat menetapkan base **gratis selamanya** (`freeForever`).
- Base gratis selamanya: user tidak membayar, base tidak mendapat revenue.

### Welcome bonus

- User baru yang **pertama kali menyelesaikan verifikasi email** mendapat welcome bonus **1 CTF**.
- Bonus diberikan sekali per akun, idempotent dengan key `welcome-bonus:<userId>`, dan memakai tipe ledger `WELCOME_BONUS`.
- Akun Google baru yang langsung terverifikasi juga mendapat bonus yang sama.
- Akun Instagram-only tanpa email belum mendapat bonus; bonus diberikan saat emailnya diverifikasi.
- User lama yang sudah terverifikasi **tidak di-backfill**. Nominal dapat diubah lewat `WELCOME_CTF_BONUS`; set `0` untuk menonaktifkan.

### Publikasi FnC-only & sosial media

- Integrasi Meta/Instagram **sudah berfungsi** untuk OAuth dan publikasi otomatis.
- Menghubungkan Instagram tetap **opsional**; base yang belum menghubungkannya tetap dapat menerbitkan fess secara normal di FnC.
- Tanpa koneksi sosmed, fess tidak menjalankan render/upload canvas maupun auto-post Instagram; `Fess.igStatus` bernilai `skipped` (bukan `failed`) dan tidak ada error yang ditampilkan ke admin/pengguna.
- Setelah Instagram terhubung, auto-post berjalan untuk fess berikutnya. Jika koneksi diputus, base kembali ke mode FnC-only tanpa mengganggu publikasi fess.
- Status koneksi Instagram yang ditampilkan ke publik dibaca dari koneksi Meta yang aktif, bukan hanya dari kolom `igAccount`.

### Paket CTF

| Paket | Harga | CTF dasar | Bonus | Total CTF | Efektif/CTF |
|---|---:|---:|---:|---:|---:|
| Coba Dulu | Rp5.000 | 25 | 0 | 25 | Rp200 |
| Hemat | Rp10.000 | 50 | 5 | 55 | Rp182 |
| Mahasiswa | Rp25.000 | 125 | 20 | 145 | Rp172 |
| Kampus | Rp50.000 | 250 | 50 | 300 | Rp167 |
| Bundling | Rp100.000 | 500 | 125 | 625 | Rp160 |

- Minimum top-up: Rp5.000.
- Kartu kredit/debit **tidak** dipakai di v1.
- Metode aktif: QRIS, GoPay, ShopeePay, VA BCA/BNI/BRI/Permata, Mandiri Bill.
- Snap dan halaman pembayaran eksternal tidak dipakai; flow pembayaran sepenuhnya in-app.

### Keamanan & refund

- `User.balance` legacy dianggap CTF dan sudah dimigrasikan ke `CtfWallet` integer.
- Treasury/payout tidak boleh membaca saldo CTF atau saldo legacy.
- Top-up non-refundable, kecuali duplicate/kesalahan teknis.
- Fess refund otomatis hanya jika ditolak atau dihapus **sebelum pertama kali terbit**.
- `Fess.publishedAt` menyimpan waktu terbit pertama. Fess yang pernah terbit tidak dapat menerima refund CTF setelah ditolak/dihapus.
- Refund fess dalam CTF; refund top-up dalam IDR lewat Midtrans.
- Semua refund/chargeback harus idempotent dan diaudit.
- Hanya Super Admin yang boleh mengubah `freeForever`, KYC, refund, dan approve payout.
- Aksi high-risk Super Admin wajib re-authentication + audit log + alert.

## 2. Status infrastruktur

| Item | Status | Catatan |
|---|---|---|
| Branch backend `feat/ctf-midtrans` | ✅ Dibuat | Kode Fase 2 & 3 ada di branch ini |
| Branch frontend `feat/ctf-midtrans` | ✅ Dibuat | Top-up, revenue, payout, KYC, freeForever UI |
| File progress | ✅ Diperbarui | Dokumen ini |
| Supabase project development | ✅ Aktif | Ref `vtvnurgkhqboygkttzae`, region `ap-south-1` |
| Vercel project dev backend | ✅ Dibuat | `be-fnc-dev` → `be-fnc-dev.vercel.app` |
| Vercel project dev frontend | ✅ Dibuat | `fessncurious-dev` → `fessncurious-dev.vercel.app` |
| Migrasi dev | ✅ Sampai `20261024040000_welcome_ctf_bonus` | Termasuk reserved payout, `Fess.publishedAt`, dan enum `WELCOME_BONUS` |
| Midtrans sandbox keys | ✅ Aktif di dev | `MIDTRANS_SERVER_KEY` / `MIDTRANS_CLIENT_KEY` terpasang sebagai Vercel Sensitive env di `be-fnc-dev`; key sandbox valid walau tanpa prefix `SB-Mid-` |
| Midtrans notification URL | ✅ Terverifikasi | `https://be-fnc-dev.vercel.app/api/payments/midtrans/notification`; notifikasi asli QRIS dan BCA VA diterima dan diproses |
| Dev backend deployment terbaru | Selesai | `dpl_4AdsNFxCAyEchyKvaQWSb9dap7SQ` -> https://be-fnc-dev.vercel.app (welcome bonus; flag off) |
| Dev frontend deployment terbaru | Selesai | `dpl_9miwFrC66rNuFLqj3ZFbzM774PVv` -> https://fessncurious-dev.vercel.app (polish wallet/top-up; flag off) |
| Flag dev | ✅ Aman | `PAYMENTS_ENABLED=false`, `BASE_PAYOUTS_ENABLED=false` setelah jendela test |
| Dev callback / OAuth | ✅ Berfungsi | Midtrans ✅; Google dilaporkan selesai; Meta/Instagram OAuth + callback berfungsi dan tetap opsional untuk base FnC-only |
| Production | ✅ Tidak disentuh | Tetap menunggu sign-off |

> Isolasi dev memakai **project Vercel terpisah**. Subdomain `dev.fessncurious.vercel.app` tidak bisa dibuat karena `fessncurious.vercel.app` adalah domain milik Vercel.

Project Vercel dev:

- Backend: `be-fnc-dev` (`prj_U3gr5zZHt5S1DD128Y8Hak30DdEl`)
- Frontend: `fessncurious-dev` (`prj_11AGuBPTjOTBMjYXYY6zU2opoL9a`)
- Team: `team_eagY6z8dtwxMU3LixbCgyk4V`
- Production branch project dev masih `main`; deploy branch kerja dilakukan manual.
- Deploy dev hanya dengan `--project` eksplisit:
  - `vercel deploy --prod --project be-fnc-dev --scope team_eagY6z8dtwxMU3LixbCgyk4V --yes`
  - `vercel deploy --prod --project fessncurious-dev --scope team_eagY6z8dtwxMU3LixbCgyk4V --yes`
- Jangan menjalankan `vercel deploy --prod` tanpa `--project`.

## 3. Environment variables

### Pemisahan env lokal

- Production tetap memakai `backend/.env` (tidak disentuh).
- Dev memakai `backend/.env.development` (gitignored) dengan Supabase project dev.
- Template aman ada di `backend/.env.development.example`.
- Vercel dev memakai environment variables project `be-fnc-dev` / `fessncurious-dev`.

### Backend

```env
# Feature flags - tetap false sampai sign-off
PAYMENTS_ENABLED=false
BASE_PAYOUTS_ENABLED=false

# Welcome bonus 1 CTF untuk user baru yang emailnya terverifikasi
WELCOME_CTF_BONUS=1

# Payout
BASE_PAYOUT_FEE_IDR=6500

# Midtrans sandbox — isi nilainya di lokal/Vercel, jangan commit
MIDTRANS_IS_PRODUCTION=false
MIDTRANS_SERVER_KEY=
MIDTRANS_CLIENT_KEY=
MIDTRANS_MERCHANT_ID=

# Rekonsiliasi
PAYMENT_RECONCILE_SECRET=

# CORS allowlist
ALLOWED_ORIGINS=http://localhost:5173,https://fessncurious-dev.vercel.app

# Database dev
DATABASE_URL=
DIRECT_URL=
```

### Frontend

```env
VITE_API_BASE=https://be-fnc-dev.vercel.app/api
VITE_BACKEND_URL=https://be-fnc-dev.vercel.app
VITE_PAYMENTS_ENABLED=false
```

Jangan pernah menaruh `MIDTRANS_SERVER_KEY` di frontend atau di commit.

## 4. Rencana implementasi

### Fase 0 — Persiapan

- [x] Kunci keputusan produk dan paket.
- [x] Buat branch backend & frontend `feat/ctf-midtrans`.
- [x] Buat progress tracker.
- [x] Buat Supabase project development.
- [x] Buat Vercel project dev backend + frontend.
- [x] Isi environment dev (DB, storage, JWT, email).
- [x] Deploy backend dev + verifikasi health/DB/CORS.
- [x] Deploy frontend dev + verifikasi build memakai API dev.
- [x] Isi Midtrans sandbox keys yang valid dan verifikasi transaksi.
- [x] Audit saldo `User.balance` existing (read-only) + backfill.

### Fase 1 — Schema & ledger

- [x] `CtfWallet`, `CtfLedgerEntry`, `PaymentOrder`, `PaymentEvent`, `FessCharge`.
- [x] `Base.trialEndsAt`, `Base.freeForever`, kontrol payout/KYC/bank.
- [x] `BaseRevenueWallet` + `reservedIdr`.
- [x] `BaseRevenueEntry`, `BasePayout`, `AdminAuditLog`.
- [x] `Fess.idempotencyKey`, `Fess.publishedAt`, `SystemSetting`.
- [x] Migrasi additive + backfill aman; diterapkan di Supabase dev.
- [x] `CtfWalletService` credit/debit atomik + idempotency + anti-saldo-negatif.
- [x] Legacy treasury admin pindah ke `BaseRevenueWallet` IDR.
- [x] Payout legacy diblokir `503 PAYOUTS_DISABLED` saat flag false.
- [x] Base baru otomatis trial 7 hari + revenue wallet.

### Fase 2 — Top-up Midtrans

- [x] Service Midtrans Core API (QRIS, VA, Mandiri Bill, GoPay, ShopeePay).
- [x] `GET /payments/packages`
- [x] `POST /payments/orders` + idempotency key.
- [x] `GET /payments/orders/:id`
- [x] `GET /payments/orders`
- [x] Webhook signature SHA512, amount/currency/order checks.
- [x] Webhook invalid signature ditolak sebelum DB write.
- [x] Idempotent credit ledger.
- [x] Rekonsiliasi status + cron/internal reconcile endpoint.
- [x] Rate limit in-memory + Postgres fixed-window.
- [x] CORS allowlist ketat.

### Fase 3 — Fess, trial, refund

- [x] Cek trial/freeForever di `createFess`.
- [x] Wajib login + email verified untuk base berbayar.
- [x] Debit CTF atomik saat membuat fess berbayar.
- [x] `FessCharge` + ledger + idempotency key fess.
- [x] Refund otomatis saat reject/delete sebelum pertama terbit.
- [x] Fess yang pernah terbit tidak refund CTF setelah ditolak/dihapus.
- [x] Error `402 INSUFFICIENT_CTF`.
- [x] Error `401 PAID_FESS_AUTH_REQUIRED` / `403 EMAIL_NOT_VERIFIED`.
- [x] Charge CTF dan saldo baru ditampilkan di composer/toast.
- [x] Harga 1 CTF terlihat sebelum publish: label tombol, catatan composer, modal biaya, saldo sebelum → sesudah, dan tombol konfirmasi eksplisit.
- [x] Re-approve fess yang charge-nya sudah direfund diblokir `FESS_CHARGE_REFUNDED`.

### Fase 4 — Frontend

- [x] Top-up flow in-app (paket, metode, QR/VA/deeplink, countdown).
- [x] Polling status + resume pending order.
- [x] Riwayat transaksi.
- [x] Update saldo setelah top-up.
- [x] Composer menampilkan biaya CTF dan saldo setelah publish.
- [x] Tombol publish menampilkan `Posting · 1 CTF` / `Jadwalkan · 1 CTF` saat base berbayar.
- [x] Base dashboard: saldo IDR, revenue, hold, payout, rekening, KYC read-only.
- [x] Super Admin: review payout, KYC, freeForever, re-auth.
- [x] Badge trial/gratis/1 CTF di composer sebelum publish.
- [x] Modal konfirmasi menampilkan `Biaya posting 1 CTF`, `Saldo CTF 159 → 158`, dan tombol `Posting & Potong 1 CTF`.
- [x] Modal saldo kurang dengan CTA top-up.
- [x] Public base badge (`Berbayar · 1 CTF/fess` + status koneksi Instagram nyata).
- [x] Audit copy legal/help lama yang masih menyebut treasury $CLUB/85%, Threads/X, dan klaim gratis tanpa batas.

### Fase 5 — Base revenue, payout, freeForever

- [x] Kredit `BaseRevenueEntry` Rp80/fess saat fess terbit.
- [x] Exclude self-post, trial, dan freeForever.
- [x] Holding 7 hari + release otomatis.
- [x] Reversal saat fess diturunkan setelah terbit.
- [x] Request payout min Rp50.000 → reserve `availableIdr` ke `reservedIdr`.
- [x] Review Super Admin: approve, reject, mark paid, mark failed.
- [x] Reject/fail melepas reservation; mark paid mengonsumsi reservation.
- [x] KYC + rekening bank; perubahan rekening re-auth + hold 24 jam.
- [x] `freeForever` Super Admin + re-auth + reason + audit + alert.
- [x] Base Admin read-only untuk KYC/freeForever.
- [x] Self-approval payout diblokir.

### Fase 6 — Keamanan, test, rollout

- [x] Unit test signature/amount/idempotency.
- [x] Test concurrent debit / anti-negative balance.
- [x] Test trial boundary.
- [x] Test anonymous + unverified paid base.
- [x] Test refund & revenue reversal, termasuk published → rejected → deleted.
- [x] Test payout reservation/release/consume & freeForever RBAC.
- [x] CORS allowlist.
- [x] Rate limit terdistribusi.
- [x] E2E Midtrans sandbox (QRIS + BCA VA via simulator, notifikasi asli; duplicate/invalid signature/amount mismatch/unknown order diuji).
- [x] E2E fess berbayar dev: debit 1 CTF, idempotency replay tanpa double charge, revenue base Rp80 `PENDING`, dan verifikasi UI sebelum submit.
- [x] Smoke UI top-up dev: `Coba Dulu` Rp5.000 / 25 CTF via BCA VA, saldo naik tepat sekali, UI sukses langsung menampilkan saldo baru.
- [x] Verifikasi live parser WIB: expiry `24.001` jam (bukan 31 jam) dan `paid_at` dalam `0.35` menit dari settlement; saldo UI langsung terlihat.
- [x] Order pending -> expired lewat Midtrans expire API; status backend `expired`, saldo CTF tidak berubah.
- [x] Refund QRIS asli lewat Midtrans refund API; status backend `refunded`, CTF tidak didebit otomatis.
- [x] Idempotensi audit refund/chargeback: audit hanya ditulis saat transisi status; replay signed notification tidak menambah audit.
- [x] Rekonsiliasi manual endpoint diuji: secret salah `401`, secret benar `200` (`checked=1, processed=1, failed=0`). Cron/rekonsiliasi terjadwal belum dikonfigurasi.
- [x] Deploy dev terbaru (backend `dpl_4AdsNFxCAyEchyKvaQWSb9dap7SQ`, frontend `dpl_9miwFrC66rNuFLqj3ZFbzM774PVv`).
- [x] Polish UI wallet/top-up (frontend `a95807a`) dan verifikasi deployed light/dark desktop/mobile; flag pembayaran tetap mati.
- [ ] Sign-off.
- [ ] Production canary.

## 5. API baru Fase 3

| Method | Path | Akses |
|---|---|---|
| GET | `/api/admin/base-revenue` | Base Admin (base sendiri), Super Admin (semua base) |
| GET | `/api/admin/base-revenue/payouts` | Base Admin, Super Admin |
| POST | `/api/admin/base-revenue/payouts` | Base Admin, Super Admin + `Idempotency-Key` |
| POST | `/api/admin/base-revenue/payouts/:id/review` | Super Admin |
| PUT | `/api/admin/base-revenue/bank` | Base Admin, Super Admin + password |
| POST | `/api/admin/base-revenue/kyc` | Super Admin + password |
| POST | `/api/admin/base-revenue/free-forever` | Super Admin + password + reason |

Aksi review payout: `approve`, `reject`, `mark_paid`, `mark_failed`.
Approve dan mark-paid mewajibkan password re-auth. Semua aksi menolak self-approval dan menulis audit log.

## 6. Definisi selesai (acceptance criteria)

- User bisa top up dan saldo bertambah tepat sekali.
- Fess berbayar memotong tepat 1 CTF.
- Trial base bekerja sesuai tanggal.
- Base gratis selamanya tidak memotong CTF.
- Fess ditolak/dihapus sebelum terbit mengembalikan CTF tepat sekali.
- Fess yang pernah terbit tidak mengembalikan CTF setelah take-down.
- Revenue base bertambah Rp80 hanya untuk fess berbayar yang terbit, bukan self-post.
- Payout tidak bisa melebihi saldo available.
- Tidak ada saldo CTF yang bisa ditarik sebagai uang.
- Hanya Super Admin yang bisa mengubah freeForever/KYC/refund/payout.
- Semua aksi high-risk tercatat di audit log.
- Build backend/frontend dan seluruh test lulus.
- E2E Midtrans sandbox lulus.
- Sign-off eksplisit sebelum production.

## 7. Gate yang masih terbuka

1. **Skenario Midtrans lanjutan** — pending/expire dan refund QRIS sudah diuji dengan transaksi sandbox asli. Chargeback tidak dapat dipicu langsung dari sisi merchant di sandbox; logika chargeback serta replay refund ditutup dengan unit test dan signed notification. Rekonsiliasi manual endpoint sudah diuji, tetapi **cron/rekonsiliasi terjadwal belum dikonfigurasi**.
2. **Midtrans production** — production key/environment belum diisi dan tidak boleh memakai key sandbox.
3. **Sign-off** — `PAYMENTS_ENABLED` dan `BASE_PAYOUTS_ENABLED` tetap `false` sampai disetujui.
4. **Production** — jangan deploy/merge sebelum sign-off; production env dan deployment belum disentuh.
5. **Operasional produksi** — cron rekonsiliasi, alert pembayaran, dan runbook refund/chargeback manual masih perlu disiapkan sebelum canary.

Catatan: Meta/Instagram **sudah berfungsi** dan bukan gate production. Integrasinya tetap opsional; base tanpa koneksi sosmed beroperasi penuh sebagai base FnC-only.

## 8. Bukti E2E dev (2026-10-24)

- Validasi kredensial: sandbox API menerima key (HTTP 200 `Transaction doesn't exist`), production API menolak (401). Prefix `Mid-server-` bukan indikator environment; service memilih host hanya dari `MIDTRANS_IS_PRODUCTION`.
- QRIS sandbox: order `FNC-MVLSIXS8-CFB0F55D1A`, Rp5.000, 25 CTF, dibayar lewat simulator Midtrans; notifikasi asli diterima dan order menjadi `PAID`.
- BCA VA sandbox: order `FNC-MVLSK5MK-A679B4BF82`, Rp10.000, 55 CTF, VA `82370900254356908824431`, dibayar lewat simulator; notifikasi asli diterima dan order menjadi `PAID`.
- Saldo test user naik dari 80 menjadi 160 CTF (25 + 55) setelah dua settlement asli; tidak ada kredit ganda.
- Synthetic webhook: duplicate replay `already_processed`; signature salah 401 tanpa DB write; unknown order 200 `unknown_order`; amount mismatch 400 `PAYMENT_AMOUNT_MISMATCH`.
- Idempotency order: request ulang dengan `Idempotency-Key` yang sama mengembalikan 200 dan order ID yang sama.
- Setelah pengujian, `PAYMENTS_ENABLED=false` dan `BASE_PAYOUTS_ENABLED=false`; backend dev dideploy ulang dan `GET /payments/packages` mengembalikan `enabled:false`, `configured:true`.
- Test backend saat E2E tersebut: 306/306 lulus; build backend & frontend lulus.
- Smoke API dev setelah deploy: `GET /api/bases` mengembalikan objek `billing`; detail `@testbase` mengembalikan `billing.reason=trial` dan `instagram_connected=true`; `GET /api/payments/packages` tetap `enabled:false`, `configured:true`.

### 8.1 E2E fess berbayar (2026-10-24)

- Fixture dev: `@paidtest` (`cmvlvkqo80001jw08e15ff7z5`), creator `@testbase`, `freeForever=false`, `trialEndsAt=null`, `postMode=auto`, tanpa koneksi Instagram level base. Base dibuat lewat API setelah `baseTrialUsedAt` creator di-set sementara; nilai creator dikembalikan ke `null` setelah base dibuat.
- Sebelum submit: saldo `@pawarnash` **160 CTF**.
- `POST /api/fesses` dengan `Idempotency-Key: paidtest-e2e-20261024-01` → `201`, `status=published`, `charged_ctf=1`, `ctf_balance=159`, `base_billing.requires_payment=true`.
- Replay dengan key yang sama → fess ID sama, saldo tetap **159 CTF** (tidak ada double charge).
- Verifikasi DB: tepat **1** `FessCharge` `CHARGED` nominal 1; tepat **1** `CtfLedgerEntry` `FESS_CHARGE` nominal `-1` dengan `balanceAfter=159`; tepat **1** `Fess` untuk idempotency key tersebut; `BaseRevenueEntry` Rp80 `PENDING`; `BaseRevenueWallet.pendingIdr=80`.
- Insiden yang ditemukan: percobaan pertama gagal `P2028` pada `prisma.fessCharge.create()` karena transaksi fess berbayar melebihi timeout default 5 detik di DB dev yang lambat. Perbaikan: `prisma.$transaction(fn, { maxWait: 10_000, timeout: 30_000 })` di `fess.service.ts`, plus assertion regresi di `tests/fess.service.test.ts`. Setelah deploy dev `dpl_8aq64xBqhV9RQBgzFesWYvGAyepS`, retest lulus.
- Verifikasi UI Playwright di dev:
  - Tombol header: `Posting · 1 CTF`.
  - Catatan composer: `Fess ini berbayar 1 CTF dan akan dipotong dari saldo kamu. Saldo kamu 159 CTF.`
  - Modal: `Biaya posting 1 CTF`, `Saldo CTF 159 CTF → 158 CTF`, dan peringatan `1 CTF akan dipotong dari saldo kamu saat fess dikirim.`
  - Tombol konfirmasi: `Posting & Potong 1 CTF`.
  - Badge publik `@paidtest`: `Berbayar · 1 CTF/fess`.
- Catatan fixture: creator `@testbase` memiliki koneksi Instagram level user `@2003.paw`, sehingga fess uji auto-post ke Instagram. Jangan submit fess uji lagi ke `@paidtest`/`@testbase` sebelum auto-post dimatikan.

### 8.2 Smoke UI top-up + perbaikan waktu Midtrans (2026-10-24)

- Jendela test: `PAYMENTS_ENABLED=true` hanya di project dev `be-fnc-dev`; production tidak disentuh. `GET /payments/packages` mengembalikan `enabled:true`, `configured:true`.
- Smoke pertama (Hemat, BCA VA, order `FNC-MVLZN8EQ-0F32B318A5`): dibuat dari UI, VA dibayar lewat simulator Midtrans, status menjadi `Pembayaran berhasil`; saldo `159 -> 214 CTF` (+55) dan `GET /auth/me` juga 214. Ditemukan panel sukses masih menampilkan saldo lama `159 CTF` sesaat sebelum `fetchMe` selesai.
- Fix frontend `6af3bb1` (`fix(wallet): show topped-up CTF balance immediately`): saldo dikreditkan optimistis hanya saat order yang sama bertransisi `pending -> paid`; membuka ulang order yang sudah `paid` tidak menambah CTF lagi. Build frontend lulus dan dideploy `dpl_8po9KhPNDguEJtsUEuaFxLNjHMZV`.
- Smoke kedua (paket terkecil `Coba Dulu`, BCA VA, order `FNC-MVLZW93P-32FEC6A22D`, VA `82370488017864321404495`): dibuat dan dibayar dari UI. Hasil: `Pembayaran berhasil`, `+25 CTF`, saldo `214 -> 239 CTF`; panel sukses langsung menampilkan `Saldo sekarang: 239 CTF` dan `GET /auth/me` = 239. Verifikasi Playwright + screenshot lulus.
- Bug waktu Midtrans ditemukan dari order di atas: status API mengirim `transaction_time=2026-10-24 13:05:45`, `settlement_time=2026-10-24 13:05:53`, dan `expiry_time=2026-10-25 13:05:45` (WIB tanpa offset). Parser lama menyimpannya sebagai UTC sehingga `paid_at` tercatat 7 jam ke depan dan countdown kedaluwarsa menjadi 31 jam. Fix `1d1e941` (`fix(payments): parse Midtrans timestamps as WIB`) memakai `parseMidtransDate` untuk `settlement_time` dan `expiry_time`; konversi benar menjadi `2026-10-24T06:05:53.000Z` dan `2026-10-25T06:05:45.000Z`. Test regresi ditambahkan.
- Backend full suite: **309/309 lulus** (`npx vitest run --testTimeout=60000`); build backend & frontend lulus.
- Restore flag: `PAYMENTS_ENABLED=false` + `BASE_PAYOUTS_ENABLED=false`; deploy backend `dpl_BvKN6mMrXXAnEiYZftvc8Tg2h5un`. Verifikasi: `GET /payments/packages` -> `enabled:false`, `configured:true`; UI `/wallet` menampilkan `Top up belum dibuka` dan tidak ada package card.
- Catatan dev: setelah smoke kedua, ada order `Kampus` GoPay Rp50.000 (300 CTF) dari sesi dev lain yang menaikkan saldo `@pawarnash` ke **539 CTF**. Order itu tidak termasuk smoke test ini. Masih ada order `Kampus` BCA VA pending `FNC-MVLZOLTX-833F32D64E` dari sesi lain; order pending tersebut tidak menambah saldo.

### 8.3 Lifecycle Midtrans, refund, dan idempotensi (2026-10-24)

- Jendela test memakai project dev `be-fnc-dev` dengan `PAYMENTS_ENABLED=true`; production tidak disentuh. Test user `@pawarnash` mulai dari **539 CTF**.
- **Parser WIB live** — order `FNC-MVM17O6T-A5E51E5F37` (Coba Dulu, BCA VA) dibuat `2026-10-24T06:42:35.958Z`, `expires_at=2026-10-25T06:42:38.000Z` sehingga selisihnya **24.001 jam** (bukan 31 jam). VA dibayar lewat simulator; backend menjadi `paid`, `paid_at=2026-10-24T06:42:59.000Z` (selisih **0.35 menit** dari waktu pengecekan), dan panel sukses UI langsung menampilkan `Saldo sekarang: 564 CTF`. Saldo `539 -> 564`.
- **Expire** — order `FNC-MVM18TA0-3AB0327666` (Coba Dulu, BCA VA) dibuat lalu di-expire lewat Midtrans API. Status Midtrans `expire` (`status_code=407`), status backend `expired`, dan saldo tetap **564 CTF** (tidak ada kredit).
- **Refund QRIS asli** — order `FNC-MVM19T8V-455F3B3D33` (Coba Dulu, QRIS) dibayar lewat simulator pada `2026-10-24T06:45:41.000Z`; saldo `564 -> 589`. Refund dikirim lewat Midtrans Refund API dan disetujui (`status_code=200`, "Success, refund request is approved"). Notifikasi asli membuat order menjadi `refunded`, `refunded_at=2026-10-24T06:50:44.630Z`; DB mencatat `refundedAmountIdr=5000`, `refundReason='Midtrans refund'` (alasan asli `dev lifecycle test` tersimpan di payload audit). Saldo CTF tetap **589** karena refund top-up tidak boleh mendebit CTF otomatis.
- **Temuan idempotensi audit** — sebelum perbaikan, satu refund bisa menghasilkan dua baris `PAYMENT_REFUND_RECEIVED` karena notifikasi dan pengecekan status sama-sama menerapkan status refund. Perbaikan: update refund hanya diizinkan dari `PAID`/`PARTIAL_REFUND`, chargeback hanya dari `PAID`, dan audit hanya ditulis bila `updateMany().count > 0`. Empat unit test refund/chargeback ditambahkan.
- **Verifikasi replay setelah deploy** — signed notification refund dikirim ulang untuk order yang sudah `refunded`; respons `200 {status:'refunded', ignored:true}` dan jumlah audit `PAYMENT_REFUND_RECEIVED` tetap **2** (tidak bertambah). Dua baris lama dibiarkan sebagai bukti insiden dev.
- **Rekonsiliasi manual** — `POST /api/payments/reconcile` dengan secret salah mengembalikan `401`; dengan secret benar mengembalikan `200 {ok:true, checked:1, processed:1, failed:0}` dalam ~5,75 detik. Satu order pending diproses tanpa perubahan saldo. Cron/rekonsiliasi terjadwal belum dikonfigurasi.
- **Test & build** — backend full suite **313/313 lulus**; `npm run build` backend lulus.
- **Restore flag** — `PAYMENTS_ENABLED=false`, `BASE_PAYOUTS_ENABLED=false`; backend dev dideploy `dpl_JJnJGo3RyErQby4Rrxi6oRVPkQpK`. `GET /payments/packages` -> `enabled:false`, `configured:true`; UI `/wallet` menampilkan `Top up belum dibuka`; saldo tetap **589 CTF**.
- **Artefak saldo dev** — 25 CTF dari order QRIS yang direfund tetap ada di saldo dev karena desain tidak mendebit CTF otomatis; ini harus ditinjau manual pada production. Order lifecycle: `FNC-MVM17O6T-A5E51E5F37` paid, `FNC-MVM18TA0-3AB0327666` expired, `FNC-MVM19T8V-455F3B3D33` refunded, `FNC-MVLZOLTX-833F32D64E` (Kampus) masih pending.

### 8.4 Welcome bonus 1 CTF + logo pembayaran (2026-10-24)

- Migrasi enum `20261024040000_welcome_ctf_bonus` diterapkan ke DB dev; tidak ada perubahan production.
- Deploy dev: backend `dpl_4AdsNFxCAyEchyKvaQWSb9dap7SQ`, frontend `dpl_DVKgcZ1VuLdCeHzwsLeB6bRPR2F3`. `GET /payments/packages` tetap `enabled:false`, `configured:true`; production tidak disentuh.
- Verifikasi end-to-end lewat API deployed memakai user sementara: register -> OTP -> verifikasi email pertama menghasilkan saldo **1 CTF**, `GET /auth/me` = **1 CTF**, ledger tunggal `WELCOME_BONUS` amount `1`, idempotency `welcome-bonus:<userId>`, dan replay verifikasi tetap **1 CTF**. User sementara dibersihkan setelah test.
- Unit test: `welcome-bonus.service.test.ts` 3 test (amount 1, disabled, transaction/Google source), auth verification test memastikan bonus dipanggil di transaksi yang sama; backend full suite **316/316 lulus**; build backend lulus.
- UI payment option memakai aset brand lokal: QRIS, GoPay, ShopeePay, BCA, BNI, BRI, Permata, Mandiri. Frontend build lulus dan seluruh SVG masuk bundle.
- Verifikasi visual frontend deployed memakai Playwright viewport mobile `430x932` dengan respons API `payments` di-intercept (karena flag dev mati): 8 metode tampil, 8 logo termuat (`naturalWidth > 0`), tidak ada console error. Screenshot verifikasi disimpan sebagai artefak sesi, bukan di repo.
- Catatan: bonus untuk akun Google baru memakai jalur `google_signup`; akun Instagram-only tanpa email tidak mendapat bonus sampai email terverifikasi. User lama tidak di-backfill.

### 8.5 Polish UI wallet & top-up (2026-10-24)

- Frontend commit `a95807a` (`feat(wallet): polish top-up selection and payment states`); deploy dev frontend `dpl_9miwFrC66rNuFLqj3ZFbzM774PVv` -> https://fessncurious-dev.vercel.app. Backend tidak berubah pada pass ini.
- Tampilan baru: hero saldo, tiga pesan kepercayaan, kartu paket dengan penanda `Paling hemat` berbasis rasio CTF/IDR, metode pembayaran berkelompok, ringkasan checkout sticky, CTA fixed di mobile/tablet sampai `980px`, panel instruksi VA/QRIS/e-wallet/Mandiri, state sukses/refund/expired/failed/chargeback, serta riwayat yang lebih ringkas.
- Perilaku: setelah order dibuat atau dibuka, halaman scroll ke panel pembayaran (offset `82px`); kegagalan membuat/membuka/mengecek order tampil inline dan sebagai toast; `Idempotency-Key` dipertahankan pada kegagalan ambigu; status pembayaran diumumkan lewat `role="status"` pada pill, bukan pada countdown per detik.
- Kebenaran copy: status `expired` memakai treatment warning dengan ikon jam, `refunded` memakai ikon refresh, sedangkan `failed`/`chargeback` memakai treatment danger. Toast sukses hanya muncul saat transisi `pending -> paid`, bukan saat membuka order yang sudah lama dibayar.
- Verifikasi lokal Playwright: light/dark desktop dan mobile, lebar `360, 430, 768, 900, 980, 981, 1024, 1440px`, tanpa horizontal overflow atau console error; 5 paket, 8 metode, 8 logo termuat (`naturalWidth > 0`); `Bundling` menjadi kartu featured dan fixed CTA tampil sampai `980px`.
- Flow UI dengan API mock: CTA mobile membuat paket `hemat` + `bca_va`, mengirim `Idempotency-Key`, menampilkan VA BCA, lalu `Cek status` mengubah state ke `paid` dan saldo `589 -> 734` CTF; panel pembayaran berhenti di offset `82px`. Error `503` menampilkan inline error + toast, tombol aktif kembali, dan retry memakai idempotency key yang sama.
- Verifikasi deployed: state terkunci memakai respons asli `GET /payments/packages` dev (`enabled:false`, `configured:true`); preview `enabled:true` memakai intercept agar flag dev tidak diubah. Desktop/mobile light/dark memuat bundle `TopUpFlow-DaX10m_8.js`, 5 paket, 8 metode, 8 logo, tanpa overflow/error. `PAYMENTS_ENABLED=false` dan `BASE_PAYOUTS_ENABLED=false` tetap berlaku; production tidak disentuh.
- Frontend build lulus; Prettier check lulus untuk dua file yang berubah (`TopUpFlow.vue`, `WalletPage.vue`).

## 9. Log perubahan

| Tanggal | Perubahan |
|---|---|
| 2026-10-23 | Branch fitur dan progress tracker dibuat; keputusan produk dikunci. |
| 2026-10-24 | Supabase dev (`ap-south-1`) terhubung, bucket dev dibuat; backend/frontend dev live. |
| 2026-10-24 | CORS allowlist diterapkan dan diuji; origin asing ditolak 403. |
| 2026-10-24 | Migrasi `ctf_payments_ledger`: wallet, ledger, payment, revenue, payout, audit, trial/freeForever; backfill `User.balance` terverifikasi. |
| 2026-10-24 | Treasury admin pindah ke `BaseRevenueWallet` IDR; payout legacy diblokir 503 saat flag false. |
| 2026-10-24 | Fase 2 selesai: Midtrans Core API, webhook SHA512, idempotency, reconciliation, rate limiting. |
| 2026-10-24 | Fase 3 selesai: fess billing, refund policy, revenue Rp80, reserved payout, KYC/bank/freeForever, audit + re-auth. |
| 2026-10-24 | `Fess.publishedAt` + migrasi: refund CTF hanya jika belum pernah terbit. |
| 2026-10-24 | Frontend: top-up, composer charge UX, Base Admin revenue/payout/bank, Super Admin payout/KYC/freeForever. |
| 2026-10-24 | Backend full suite 303 test lulus; build backend & frontend lulus. |
| 2026-10-24 | Perbaikan Midtrans: guard prefix dihapus karena key sandbox valid juga memakai prefix `Mid-server-`; host tetap dipilih dari `MIDTRANS_IS_PRODUCTION`. |
| 2026-10-24 | Vercel dev `be-fnc-dev` diisi `MIDTRANS_SERVER_KEY` / `MIDTRANS_CLIENT_KEY` (sensitive), `MIDTRANS_IS_PRODUCTION=false`; `GET /payments/packages` mengembalikan `configured:true`. |
| 2026-10-24 | E2E sandbox asli lulus: QRIS Rp5.000 + BCA VA Rp10.000 dibayar via simulator, notifikasi asli masuk, saldo test naik 80 -> 160 CTF; replay/signature/amount/idempotency diuji. |
| 2026-10-24 | Jendela test ditutup: `PAYMENTS_ENABLED=false`, `BASE_PAYOUTS_ENABLED=false`; backend dev dideploy ulang `dpl_3yFf4JFHtXxoRzvMNG6snmxMu5GA`. |
| 2026-10-24 | Publikasi FnC-only: base tanpa koneksi Instagram tidak lagi render/auto-post atau mencatat `failed`; fess terbit normal dengan `igStatus=skipped`. Copy registrasi/onboarding sosial media dijadikan opsional. |
| 2026-10-24 | Meta/Instagram dinyatakan berfungsi (OAuth + callback); tetap opsional dan bukan gate. Base tanpa sosmed tetap FnC-only. |
| 2026-10-24 | Fase 4 selesai: badge billing composer, modal saldo kurang + CTA top-up, badge publik, status koneksi Instagram nyata, serta audit copy legal/help/FAQ/landing. |
| 2026-10-24 | Backend full suite 306 test lulus; build backend & frontend lulus. |
| 2026-10-24 | Deploy dev: backend `dpl_7DkTGmqcWVXTCugUn8AwKMrW9yad`, frontend `dpl_BAAeh6V3KC6j4aWB7R2enYdMEHUA`; smoke API billing/Instagram lulus, flag pembayaran tetap mati. |
| 2026-10-24 | E2E fess berbayar dev lulus: 1 CTF didebit (160 → 159), replay idempotent tidak double charge, revenue base Rp80 `PENDING`. Ditemukan dan diperbaiki timeout transaksi `P2028` dengan `maxWait=10s`/`timeout=30s`. |
| 2026-10-24 | Copy UI biaya diperjelas: `Posting · 1 CTF`, saldo sebelum → sesudah di modal, dan tombol `Posting & Potong 1 CTF`; badge publik `Berbayar · 1 CTF/fess`. Diverifikasi Playwright di dev. |
| 2026-10-24 | Deploy dev terbaru: backend `dpl_8aq64xBqhV9RQBgzFesWYvGAyepS`, frontend `dpl_65MisBby2gDw9QTunSUtHYurvCyL`; flag tetap `PAYMENTS_ENABLED=false`, `BASE_PAYOUTS_ENABLED=false`. |
| 2026-10-24 | Smoke UI top-up lulus: Hemat 159 -> 214 CTF, lalu `Coba Dulu` 214 -> 239 CTF via BCA VA. Panel sukses sempat menampilkan saldo lama; fix optimistis `6af3bb1`, frontend dev `dpl_8po9KhPNDguEJtsUEuaFxLNjHMZV`. |
| 2026-10-24 | Parser waktu Midtrans diperbaiki `1d1e941`: `settlement_time`/`expiry_time` WIB tidak lagi bergeser 7 jam. Backend full suite 309/309 lulus; backend dev `dpl_BvKN6mMrXXAnEiYZftvc8Tg2h5un`; `PAYMENTS_ENABLED=false` dan UI top-up terkunci. |
| 2026-10-24 | Lifecycle sandbox lulus: expiry 24.001 jam, `paid_at` benar, order expire tidak mengkredit CTF, dan refund QRIS asli membuat order `refunded` tanpa mendebit CTF. Saldo dev 539 -> 564 -> 589. |
| 2026-10-24 | Idempotensi audit refund/chargeback diperbaiki: audit hanya saat transisi status; 4 test baru; backend full suite 313/313 lulus. Replay signed refund setelah deploy tidak menambah audit. |
| 2026-10-24 | Rekonsiliasi manual diuji (`401` secret salah, `200` secret benar); flag pembayaran dikembalikan ke `false`; backend dev `dpl_JJnJGo3RyErQby4Rrxi6oRVPkQpK`; UI `/wallet` terkunci. |
| 2026-10-24 | Welcome bonus 1 CTF ditambahkan: ledger `WELCOME_BONUS`, idempotency `welcome-bonus:<userId>`, hook verifikasi email + Google baru, no backfill; migrasi `20261024040000_welcome_ctf_bonus`; 3 test baru; backend full suite 316/316 lulus. |
| 2026-10-24 | Logo metode pembayaran diganti dari ikon generik ke aset brand lokal QRIS, GoPay, ShopeePay, BCA, BNI, BRI, Permata, dan Mandiri; frontend build lulus. |
| 2026-10-24 | Deploy dev: backend `dpl_4AdsNFxCAyEchyKvaQWSb9dap7SQ`, frontend `dpl_DVKgcZ1VuLdCeHzwsLeB6bRPR2F3`; flag pembayaran tetap mati. E2E API welcome bonus lulus (1 CTF, replay 1 CTF, ledger tunggal), dan verifikasi visual 8 logo pembayaran lulus. |
| 2026-10-24 | UI wallet/top-up dipoles (frontend `a95807a`): layout dua kolom + checkout sticky, CTA mobile, kartu paket/featured, metode berkelompok, state pembayaran dan riwayat, scroll ke panel, error inline + toast, serta perbaikan ARIA. Verifikasi lokal dan deployed light/dark desktop/mobile lulus; frontend dev `dpl_9miwFrC66rNuFLqj3ZFbzM774PVv`; flag pembayaran tetap mati. |
| 2026-10-24 | Gate tersisa: chargeback asli tidak dapat dipicu dari merchant sandbox (ditutup unit test), cron rekonsiliasi terjadwal, Midtrans production, operasional refund/chargeback, sign-off. |

## 10. Checklist production (belum dijalankan)

Semua item di bawah ini **rencana**; belum ada aksi terhadap production.

### Pre-flight

- [ ] Review dan merge branch `feat/ctf-midtrans` setelah sign-off eksplisit.
- [ ] Backup database production dan terapkan migrasi additive (`prisma migrate deploy`) sebelum deploy kode, termasuk enum `WELCOME_BONUS`.
- [ ] Isi env production: `PAYMENTS_ENABLED=false`, `BASE_PAYOUTS_ENABLED=false`, `WELCOME_CTF_BONUS=1`, `MIDTRANS_IS_PRODUCTION=true`, production server/client/merchant key, `PAYMENT_RECONCILE_SECRET` kuat, DB URL, JWT, storage, email.
- [ ] Pastikan tidak ada key sandbox di project production dan tidak ada key production di frontend.
- [ ] Set Midtrans production notification URL ke `https://<domain-production>/api/payments/midtrans/notification`; aktifkan metode pembayaran dan izin refund yang disetujui.
- [ ] Set `ALLOWED_ORIGINS` hanya ke domain production; verifikasi CORS dari origin asing ditolak.
- [ ] Siapkan monitoring: error rate webhook, pembayaran pending menua, saldo negatif, amount mismatch, refund/chargeback, dan alert ke on-call.
- [ ] Siapkan cron rekonsiliasi (mis. tiap 5-10 menit) yang memanggil endpoint reconcile dengan secret; uji dry-run.
- [ ] Siapkan runbook refund/chargeback manual: verifikasi order, keputusan Super Admin, audit, dan komunikasi ke user.

### Canary

- [ ] Deploy production dengan flag pembayaran `false`; verifikasi health, login, publikasi fess FnC-only, dan `/wallet` terkunci.
- [ ] Verifikasi user baru yang emailnya terverifikasi menerima tepat 1 CTF sekali (ledger `WELCOME_BONUS`, saldo +1, replay tidak menambah), dan user lama tidak mendapat backfill.
- [ ] Aktifkan `PAYMENTS_ENABLED=true` hanya untuk jendela canary singkat.
- [ ] Satu top-up internal sekecil mungkin: verifikasi notifikasi asli, saldo naik tepat sekali, satu `CtfLedgerEntry`, dan audit.
- [ ] Satu fess berbayar: verifikasi debit 1 CTF, idempotency replay, `FessCharge`, dan `BaseRevenueEntry` Rp80 `PENDING`.
- [ ] Verifikasi order expire dan retry/reconcile tidak mengubah saldo.
- [ ] Pantau minimal satu siklus rekonsiliasi terjadwal dan satu webhook retry.
- [ ] Rollback: set `PAYMENTS_ENABLED=false`, deploy ulang, verifikasi `/wallet` terkunci dan saldo/riwayat tetap terbaca.

### Sign-off

- [ ] Product owner menyetujui canary dan hasil monitoring.
- [ ] Tidak ada duplicate credit, amount/currency mismatch, saldo negatif, atau kebocoran key.
- [ ] Baru setelah itu pertimbangkan membuka pembayaran untuk semua user.
