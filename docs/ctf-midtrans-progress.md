# CTF + Midtrans — Progress Tracker

Dokumen ini adalah sumber kebenaran tunggal untuk progres fitur **CTF (Coin to Fess), top-up Midtrans, trial base, pendapatan base, dan payout**.

- Repo backend: `ululhikam/be_FnC`
- Repo frontend: `ululhikam/con.fess_WebApp`
- Branch kerja: `feat/ctf-midtrans` (backend & frontend)
- Status: **Fase 2 & 3 selesai; E2E Midtrans sandbox (QRIS + BCA VA dengan notifikasi asli) selesai; sign-off production belum**
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
| Migrasi dev | ✅ Sampai `20261024030000_fess_published_at` | Termasuk reserved payout dan `Fess.publishedAt` |
| Midtrans sandbox keys | ✅ Aktif di dev | `MIDTRANS_SERVER_KEY` / `MIDTRANS_CLIENT_KEY` terpasang sebagai Vercel Sensitive env di `be-fnc-dev`; key sandbox valid walau tanpa prefix `SB-Mid-` |
| Midtrans notification URL | ✅ Terverifikasi | `https://be-fnc-dev.vercel.app/api/payments/midtrans/notification`; notifikasi asli QRIS dan BCA VA diterima dan diproses |
| Dev backend deployment terbaru | Selesai | `dpl_3yFf4JFHtXxoRzvMNG6snmxMu5GA` -> https://be-fnc-dev.vercel.app |
| Dev frontend deployment terbaru | Selesai | `dpl_DdJibWBB2QHzRCqHfvB952kzuSNj` -> https://fessncurious-dev.vercel.app |
| Flag dev | ✅ Aman | `PAYMENTS_ENABLED=false`, `BASE_PAYOUTS_ENABLED=false` setelah jendela test |
| Dev callback / OAuth | ⚠️ Sebagian | Midtrans ✅; Google dilaporkan selesai; Instagram/Meta masih tertahan callback production |
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
# Feature flags — tetap false sampai sign-off
PAYMENTS_ENABLED=false
BASE_PAYOUTS_ENABLED=false

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
- [x] Re-approve fess yang charge-nya sudah direfund diblokir `FESS_CHARGE_REFUNDED`.

### Fase 4 — Frontend

- [x] Top-up flow in-app (paket, metode, QR/VA/deeplink, countdown).
- [x] Polling status + resume pending order.
- [x] Riwayat transaksi.
- [x] Update saldo setelah top-up.
- [x] Composer menampilkan biaya CTF dan saldo setelah publish.
- [x] Base dashboard: saldo IDR, revenue, hold, payout, rekening, KYC read-only.
- [x] Super Admin: review payout, KYC, freeForever, re-auth.
- [ ] Badge trial/gratis/1 CTF di composer sebelum publish.
- [ ] Modal saldo kurang dengan CTA top-up.
- [ ] Public base badge.
- [ ] Audit copy legal/help lama yang masih menyebut treasury $CLUB/85%.

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
- [x] Deploy dev terbaru (backend `dpl_3yFf4JFHtXxoRzvMNG6snmxMu5GA`, frontend `dpl_DdJibWBB2QHzRCqHfvB952kzuSNj`).
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

1. **Manual UI smoke (dev)** — flow top-up dari browser belum diuji manual setelah key sandbox aktif; jalur backend + notifikasi asli sudah lulus.
2. **Meta Instagram callback** — app Meta saat ini hanya punya satu callback URL dan sudah dipakai production. Opsi: app dev terpisah (disarankan), tukar callback sementara (berisiko), atau skip Instagram E2E di dev. Google callback dilaporkan sudah selesai.
3. **Skenario Midtrans lanjutan** — pending/expire, refund/chargeback, dan rekonsiliasi terjadwal belum diuji dengan transaksi sandbox asli.
4. **Midtrans production** — production key/environment belum diisi dan tidak boleh memakai key sandbox.
5. **Sign-off** — `PAYMENTS_ENABLED` dan `BASE_PAYOUTS_ENABLED` tetap `false` sampai disetujui.
6. **Production** — jangan deploy/merge sebelum sign-off; production env dan deployment belum disentuh.

## 8. Bukti E2E dev (2026-10-24)

- Validasi kredensial: sandbox API menerima key (HTTP 200 `Transaction doesn't exist`), production API menolak (401). Prefix `Mid-server-` bukan indikator environment; service memilih host hanya dari `MIDTRANS_IS_PRODUCTION`.
- QRIS sandbox: order `FNC-MVLSIXS8-CFB0F55D1A`, Rp5.000, 25 CTF, dibayar lewat simulator Midtrans; notifikasi asli diterima dan order menjadi `PAID`.
- BCA VA sandbox: order `FNC-MVLSK5MK-A679B4BF82`, Rp10.000, 55 CTF, VA `82370900254356908824431`, dibayar lewat simulator; notifikasi asli diterima dan order menjadi `PAID`.
- Saldo test user naik dari 80 menjadi 160 CTF (25 + 55) setelah dua settlement asli; tidak ada kredit ganda.
- Synthetic webhook: duplicate replay `already_processed`; signature salah 401 tanpa DB write; unknown order 200 `unknown_order`; amount mismatch 400 `PAYMENT_AMOUNT_MISMATCH`.
- Idempotency order: request ulang dengan `Idempotency-Key` yang sama mengembalikan 200 dan order ID yang sama.
- Setelah pengujian, `PAYMENTS_ENABLED=false` dan `BASE_PAYOUTS_ENABLED=false`; backend dev dideploy ulang dan `GET /payments/packages` mengembalikan `enabled:false`, `configured:true`.
- Test backend terakhir: 303/303 lulus; build backend & frontend lulus.

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
| 2026-10-24 | Gate tersisa: manual UI smoke, Meta Instagram callback dev, skenario pending/expire/refund, Midtrans production, sign-off. |
