# CTF + Midtrans — Progress Tracker

Dokumen ini adalah sumber kebenaran tunggal untuk progres fitur **CTF (Coin to Fess), top-up Midtrans, trial base, pendapatan base, dan payout**.

- Repo backend: `ululhikam/be_FnC`
- Repo frontend: `ululhikam/con.fess_WebApp`
- Branch kerja: `feat/ctf-midtrans` (backend & frontend)
- Status: **Fase persiapan / infrastruktur**
- Jangan merge ke `main` atau deploy ke production sampai sign-off.

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
- Super Admin dapat menetapkan base **gratis selamanya**.
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
- VA/gerai minimum: Rp50.000 karena biaya flat.
- Kartu kredit/debit **tidak** dipakai di v1 (menghindari 3DS/PCI).
- Metode: QRIS, GoPay, ShopeePay, VA BCA/BNI/BRI/Permata, Mandiri Bill, Alfamart/Indomaret.

### Keamanan & refund

- `User.balance` existing dianggap CTF dan akan dimigrasikan ke `CtfWallet`.
- Treasury/payout tidak boleh membaca saldo CTF.
- Top-up non-refundable, kecuali duplicate/kesalahan teknis.
- Fess refund otomatis hanya jika ditolak atau dihapus sebelum terbit.
- Refund fess dalam CTF; refund top-up dalam IDR lewat Midtrans.
- Semua refund/chargeback harus idempotent dan diaudit.
- Hanya Super Admin yang boleh mengubah `freeForever`, konfigurasi pembayaran, refund, dan payout.
- Aksi high-risk Super Admin wajib re-authentication + audit log.

## 2. Status infrastruktur

| Item | Status | Catatan |
|---|---|---|
| Branch backend `feat/ctf-midtrans` | ✅ Dibuat | Belum di-push |
| Branch frontend `feat/ctf-midtrans` | ✅ Dibuat | Belum di-push |
| File progress | ✅ Dibuat | Dokumen ini |
| Supabase project development | ⏳ Menunggu akses | Butuh `SUPABASE_ACCESS_TOKEN`; alternatif marketplace Supabase di Vercel perlu accept terms di browser |
| Vercel project dev backend | ✅ Dibuat | `be-fnc-dev` → `be-fnc-dev.vercel.app` |
| Vercel project dev frontend | ✅ Dibuat | `fessncurious-dev` → `fessncurious-dev.vercel.app` |
| Git repo dev backend | ✅ Terhubung | `ululhikam/be_FnC` |
| Git repo dev frontend | ✅ Terhubung | `ululhikam/con.fess_WebApp` |
| Midtrans sandbox | ⏳ Belum | Butuh server/client key sandbox |
| Staging/dev database env | ⏳ Belum | Diisi setelah Supabase dev ada |
| Dev notification URL | ⏳ Belum | `https://be-fnc-dev.vercel.app/api/payments/midtrans/notification` |

> Catatan Vercel: `fessncurious.vercel.app` adalah domain project Vercel, bukan domain milik sendiri. Subdomain `dev.fessncurious.vercel.app` tidak bisa dibuat sebagai custom domain. Isolasi dev dilakukan dengan **project Vercel terpisah** (`fessncurious-dev.vercel.app`, `be-fnc-dev.vercel.app`). Jika nanti ada domain sendiri (mis. `fessncurious.com`), domain `dev.fessncurious.com` bisa dipasang ke project dev.

Project Vercel dev:

- Backend: `be-fnc-dev` (`prj_U3gr5zZHt5S1DD128Y8Hak30DdEl`)
- Frontend: `fessncurious-dev` (`prj_11AGuBPTjOTBMjYXYY6zU2opoL9a`)
- Keduanya terhubung ke repo GitHub masing-masing.
- Production branch project dev masih default (`main`); branch kerja `feat/ctf-midtrans` akan menjadi preview sampai diubah ke production branch dev atau di-deploy manual ke project dev.

## 3. Environment variables yang dibutuhkan

### Pemisahan env lokal

- Production tetap memakai `backend/.env` (tidak disentuh).
- Dev memakai `backend/.env.development` (gitignored) dengan Supabase project **kedua**.
- Template aman ada di `backend/.env.development.example`.
- Vercel dev memakai environment variables project `be-fnc-dev` / `fessncurious-dev`, bukan file `.env` production.

### Backend

```env
# Feature flags
PAYMENTS_ENABLED=false
BASE_PAYOUTS_ENABLED=false

# Midtrans sandbox
MIDTRANS_IS_PRODUCTION=false
MIDTRANS_SERVER_KEY=
MIDTRANS_CLIENT_KEY=
MIDTRANS_MERCHANT_ID=

# Rekonsiliasi
PAYMENT_RECONCILE_SECRET=

# CORS
ALLOWED_ORIGINS=http://localhost:5173,https://fessncurious-dev.vercel.app

# Database dev (diisi setelah Supabase dev dibuat)
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
- [x] Buat branch backend `feat/ctf-midtrans`.
- [x] Buat branch frontend `feat/ctf-midtrans`.
- [x] Buat progress tracker.
- [ ] Buat Supabase project development.
- [x] Buat Vercel project dev backend + frontend.
- [ ] Isi environment dev (sebagian sudah; database menunggu Supabase).
- [ ] Siapkan Midtrans sandbox.
- [ ] Audit saldo `User.balance` existing (read-only).

### Fase 1 — Schema & ledger

- [ ] `CtfWallet`
- [ ] `CtfLedgerEntry`
- [ ] `PaymentOrder`
- [ ] `PaymentEvent`
- [ ] `FessCharge`
- [ ] `Base.trialEndsAt`
- [ ] `Base.freeForever`
- [ ] `BaseRevenueWallet`
- [ ] `BaseRevenueEntry`
- [ ] `BasePayout`
- [ ] `AdminAuditLog`
- [ ] `Fess.idempotencyKey`
- [ ] `SystemSetting` config pembayaran
- [ ] Migrasi additive + backfill
- [ ] Uji migrasi di Supabase dev

### Fase 2 — Top-up Midtrans

- [ ] Service Midtrans Core API
- [ ] `GET /payments/packages`
- [ ] `POST /payments/orders`
- [ ] `GET /payments/orders/:id`
- [ ] `GET /payments/orders`
- [ ] Webhook signature SHA512
- [ ] Idempotent credit ledger
- [ ] Rekonsiliasi status
- [ ] Cron/internal reconcile endpoint
- [ ] Rate limit & validasi amount

### Fase 3 — Fess, trial, refund

- [ ] Cek trial di `createFess`
- [ ] Wajib login untuk base berbayar
- [ ] Debit CTF atomik
- [ ] `FessCharge` + ledger
- [ ] Refund otomatis saat reject/delete unpublished
- [ ] Idempotency key fess
- [ ] Error `402 INSUFFICIENT_CTF`
- [ ] Error `401 AUTH_REQUIRED_FOR_PAID_FESS`

### Fase 4 — Frontend

- [ ] `TopUpModal` / panel top-up
- [ ] Paket + metode pembayaran
- [ ] QR/VA/deeplink + countdown
- [ ] Polling status + resume pending order
- [ ] Riwayat transaksi
- [ ] Composer: badge trial/gratis/1 CTF
- [ ] Modal saldo kurang
- [ ] Update saldo setelah top-up
- [ ] Base dashboard: trial, CTF, revenue
- [ ] Public base badge
- [ ] Legal/help update

### Fase 5 — Base revenue, payout, free forever

- [ ] Kredit `BaseRevenueEntry` Rp80/fess
- [ ] Exclude self-post
- [ ] Holding 7 hari
- [ ] Reversal saat refund
- [ ] Dashboard revenue base
- [ ] Request payout (min Rp50.000)
- [ ] Approval payout Super Admin
- [ ] KYC ringan + rekening
- [ ] `Base.freeForever` + endpoint Super Admin
- [ ] Re-auth + audit + alert
- [ ] Read-only badge untuk Base Admin

### Fase 6 — Keamanan, test, rollout

- [ ] Unit test signature/amount/idempotency
- [ ] Test concurrent debit
- [ ] Test trial boundary
- [ ] Test anonymous paid base
- [ ] Test refund & revenue reversal
- [ ] Test payout & free forever RBAC
- [ ] E2E Midtrans sandbox
- [ ] CORS allowlist
- [ ] Rate limit terdistribusi
- [ ] Preview Vercel dev
- [ ] Sign-off
- [ ] Production canary

## 5. Definisi selesai (acceptance criteria)

- User bisa top up dan saldo bertambah tepat sekali.
- Fess berbayar memotong tepat 1 CTF.
- Trial base bekerja sesuai tanggal.
- Base gratis selamanya tidak memotong CTF.
- Fess ditolak/refund mengembalikan CTF tepat sekali.
- Revenue base bertambah Rp80 hanya untuk fess berbayar yang terbit, bukan self-post.
- Payout tidak bisa melebihi saldo available.
- Tidak ada saldo CTF yang bisa ditarik sebagai uang.
- Hanya Super Admin yang bisa mengubah free forever/refund/payout.
- Semua aksi high-risk tercatat di audit log.
- Build backend/frontend dan seluruh test lulus.

## 6. Blocker saat ini

1. **Supabase development** — butuh access token/organization ID. Jalankan `npx supabase login` atau set `SUPABASE_ACCESS_TOKEN`.
2. **Midtrans sandbox** — butuh server key/client key sandbox dan merchant ID.
3. **Vercel dev** — project bisa dibuat sekarang, tetapi deployment backend harus menunggu database dev dan env sandbox.

## 7. Log perubahan

| Tanggal | Perubahan |
|---|---|
| 2026-10-23 | Branch fitur dan progress tracker dibuat; keputusan produk dikunci. |
