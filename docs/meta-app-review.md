# Panduan Meta App Review — Fess n Curious

Dokumen persiapan submit App Review (Advanced Access) untuk permission
`instagram_business_basic` dan `instagram_business_content_publish`.

---

## 1. Ringkasan aplikasi (untuk form review)

Fess n Curious adalah platform multi-tenant tempat admin komunitas ("base")
mengelola confession anonim: pengguna mengirim confession, admin base
memoderasi, lalu konten yang disetujui dirender menjadi kartu JPEG dan
dipublikasikan otomatis ke akun Instagram profesional milik admin base
tersebut (Feed / carousel untuk gambar, Reels untuk video).

## 2. Yang sudah siap di kode (versi ini)

- OAuth meminta tepat 2 scope: `instagram_business_basic`,
  `instagram_business_content_publish` (tanpa permission tak terpakai).
- Graph API `v25.0` (dapat dioverride via `INSTAGRAM_API_VERSION`).
- Konten gambar selalu dikonversi ke JPEG sebelum dipublikasikan (syarat
  Meta Content Publishing).
- Token long-lived 60 hari + job auto-refresh harian (`instagram-token-refresh`).
- Guard kuota `content_publishing_limit` (100 publikasi/24 jam/akun).
- Halaman publik: Kebijakan Privasi, Ketentuan Layanan, Penghapusan Data.
- Deauthorize Callback: `POST /api/auth/instagram/deauthorize` (verifikasi
  HMAC `signed_request`; token & koneksi otomatis dicabut).
- Data Deletion Callback: `POST /api/auth/instagram/data-deletion` (menghapus
  token koneksi IG + melepas binding login `instagramId`).
- Dialog konfirmasi izin sebelum redirect OAuth (transparansi pengguna).
- Tombol "Putuskan Koneksi" menghapus access token dari server.
- Kegagalan publikasi tercatat di SystemLog dengan detail error Meta.

## 3. URL yang diisi di App Dashboard

| Setting (Meta App Dashboard)           | URL produksi |
| -------------------------------------- | ------------ |
| OAuth Redirect URI                     | `https://<domain-backend>/api/auth/instagram/callback` |
| Deauthorize Callback URL               | `https://<domain-backend>/api/auth/instagram/deauthorize` |
| Data Deletion Callback URL (opsional)  | `https://<domain-backend>/api/auth/instagram/data-deletion` |
| Data Deletion Request URL (instruksi)  | `https://<domain-frontend>/data-deletion` |
| Privacy Policy URL                     | `https://<domain-frontend>/privacy` |
| Terms of Service URL                   | `https://<domain-frontend>/terms` |
| Webhook Callback URL (opsional/verifikasi) | `https://<domain-backend>/api/auth/instagram/webhook` (verify token = `INSTAGRAM_VERIFY_TOKEN`) |

> Catatan: URL `deauthorize` & `data-deletion` adalah callback server-to-server
> (Meta memanggil via `POST`). Membukanya manual di browser kini aman — tampil
> halaman info "endpoint aktif", bukan "Cannot GET"/404.

Env backend di produksi: `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`,
`INSTAGRAM_CALLBACK_URL`, `INSTAGRAM_REDIRECT_URI`,
`INSTAGRAM_API_VERSION=v25.0`,
`INSTAGRAM_SCOPES=instagram_business_basic,instagram_business_content_publish`,
`BACKEND_PUBLIC_URL=https://<domain-backend>`.

## 4. Justifikasi permission (siap salin ke form review, English)

**`instagram_business_basic`**
> Fess n Curious is a multi-tenant platform where community admins manage
> anonymous confessions. We use instagram_business_basic solely to identify
> the Instagram professional account connected by the base admin (username
> and account ID) so the dashboard can display which account is linked and
> to authenticate the admin via Instagram Business Login. We do not read
> account content or insights with this permission.

**`instagram_business_content_publish`**
> Base admins review and approve user-submitted confessions inside the
> dashboard. For each approved confession, the app renders a high-resolution
> JPEG card (plus up to 9 submitted media items as a carousel) and publishes
> it to the admin's own Instagram professional account as a Feed
> post/carousel, or as a Reels video when the submission contains a video.
> Publishing is always initiated by the admin (approve → export), respects
> the 100 posts/24h platform limit, and can be disabled at any time by
> disconnecting the account in the dashboard.

## 5. Skrip screencast (satu video, tunjukkan kedua permission)

1. Buka aplikasi, login sebagai admin base (`@concern_fess` / akun tester).
2. Dashboard → panel "Koneksi Media Sosial" → klik
   **Login Meta OAuth** → tunjukkan dialog konfirmasi izin → layar izin
   Instagram (perhatikan scope yang diminta) → izinkan.
3. Tunjukkan kartu koneksi berubah AKTIF dengan username + info masa berlaku
   token.
4. Logout, login sebagai pengguna biasa → kirim confession (sertakan 1
   gambar) ke base tersebut.
5. Login kembali sebagai admin → panel Moderasi → setujui confession →
   jalankan export canvas (preview kartu).
6. Buka akun Instagram base → tunjukkan post terbit di Feed (dan Reels bila
   confession berisi video).
7. Tunjukkan pemutusan: panel Koneksi → **Putuskan Koneksi** → konfirmasi →
   status NONAKTIF.
8. Tunjukkan halaman publik `/privacy`, `/terms`, `/data-deletion`.

## 6. Catatan untuk reviewer (kolom "notes" form review)

- Reviewer dapat mendaftar sendiri (email/Google) lalu membuat base baru,
  atau memakai akun tes yang disiapkan — hubungi kontak di halaman privasi
  bila butuh kredensial.
- Untuk menguji `instagram_business_content_publish`, gunakan akun
  Instagram profesional milik sendiri saat menghubungkan.
- Data yang disimpan: access token (server-side), username/ID akun IG,
  dan status koneksi — semuanya terhapus saat "Putuskan Koneksi" atau
  melalui instruksi di `/data-deletion`.

## 7. Pra-syarat non-kode (dilakukan pemilik app)

- Business Verification di Meta Business Suite (wajib untuk Advanced Access
  pada app multi-tenant).
- Isi App Icon, Category, dan tombol "Test Users/Reviewer notes".
- Pastikan domain backend & frontend HTTPS publik (callback OAuth tidak
  boleh localhost untuk review).
- Kirim review per permission, lampirkan screencast di atas.

## 8. Referensi implementasi

- `src/services/instagram.service.ts` — OAuth URL, exchange token,
  long-lived token, auto-post (`autoPostFess`), guard kuota, caption.
- `src/routes/auth.routes.ts` — callback OAuth, webhook, deauthorize.
- `src/jobs/instagram-token-refresh.job.ts` — refresh token harian.
- `src/utils/instagram-media.util.ts` — konversi media ke JPEG.
- `src/utils/meta-signed-request.util.ts` — verifikasi `signed_request`.
- Frontend: `src/views/LegalPage.vue`, `src/components/admin/BaseAdminPanels.vue`.
