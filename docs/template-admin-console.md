# Konsol Template Kartu (Super Admin)

Status: **diimplementasikan di branch `feat/template-admin-import`** (28 Okt 2026).
Dokumen ini menjelaskan cara import, kepemilikan per base, versi, thumbnail, API, dan
rencana lanjutan. Untuk latar belakang renderer/geometri, lihat
[`template-svg-db-plan.md`](./template-svg-db-plan.md).

---

## 1. Tujuan

Sebelum fitur ini, 12 template SVG diisi lewat script lokal. Sekarang Super Admin dapat:

1. Meng-import SVG baru langsung dari konsol (`/super-admin/templates`).
2. Mendapat thumbnail PNG otomatis — tanpa menjalankan script.
3. Menentukan template itu milik **satu base** atau tetap menjadi **katalog bersama**.
4. Mengganti desain, merender ulang thumbnail, dan mengarsipkan template tanpa kehilangan
   fess lama.

Import tetap memakai pengukur dan normalizer yang sama dengan script lama, jadi tidak ada
dua jalur render.

---

## 2. Keputusan produk

| Aturan | Perilaku |
| --- | --- |
| Template bersama | `Template.baseId = null`. Semua base melihatnya. 12 template lama tetap bersama sampai Super Admin menugaskannya. |
| Template milik base | `Template.baseId = <id base>`. Hanya base itu yang melihat dan boleh memakainya. |
| Eksklusivitas | Satu baris template hanya punya satu pemilik. Base lain tidak bisa memakai baris yang sama. |
| Desain sama untuk base lain | Import ulang SVG yang sama sebagai **baris baru** dengan key berbeda. Eksklusivitas tetap per baris. |
| Jumlah per base | Tidak di-hardcode. Super Admin menentukan sendiri berapa template yang ditugaskan. |
| Status | Import baru default `draft`; Super Admin boleh langsung memilih `active`. |
| Hapus | Tidak ada hard delete. Aksi “Arsipkan” mengubah status menjadi `archived`; fess lama tetap dapat dirender. |
| Key | Unik global, 2–64 karakter, huruf kecil/angka/tanda hubung. Key template lama (38 key di `constants/templates.ts`) ditolak agar tidak bertabrakan. |

Catatan: kepemilikan di sini adalah **kepemilikan base**, bukan kepemilikan user. Rencana
user membeli template pribadi ada di §10.

---

## 3. Skema database

`backend/prisma/schema.prisma`:

```prisma
model Template {
  // ... kolom lama ...
  status      String   @default("active") // draft | active | archived
  sortOrder   Int      @default(0)
  baseId      String?  // null = katalog bersama
  base        Base?    @relation(fields: [baseId], references: [id], onDelete: SetNull)
  createdById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([status, sortOrder])
  @@index([baseId, status, sortOrder])
}

model Base {
  // ... kolom lama ...
  templates Template[]
}
```

Migrasi: `backend/prisma/migrations/20261028010000_template_base_ownership/migration.sql`

```sql
ALTER TABLE "Template" ADD COLUMN "baseId" TEXT;
CREATE INDEX "Template_baseId_status_sortOrder_idx"
  ON "Template"("baseId", "status", "sortOrder");
ALTER TABLE "Template"
  ADD CONSTRAINT "Template_baseId_fkey"
  FOREIGN KEY ("baseId") REFERENCES "Base"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

`onDelete: SetNull` dipilih agar menghapus base tidak menghapus riwayat desain; template
otomatis kembali menjadi katalog bersama dan tetap bisa dirender oleh fess lama.

Catatan operasional dev: `prisma migrate dev` masih gagal karena drift lama
(`Fess.igPostMethod/igPostUrl/igPostedAt`, `Report.updatedAt`, index Report). DB dev
disinkronkan dengan `npm run prisma:push:dev`. Jangan reset database dev.

---

## 4. Alur import

Endpoint: `POST /api/admin/templates` (Super Admin).

Urutan di `TemplateAdminService.create`:

1. Cek key belum dipakai (`Template.key` unik).
2. `analyzeTemplateSvg(svg, key)`:
   - key divalidasi dan key legacy ditolak;
   - ukuran maksimal **2MB**;
   - SVG dinormalisasi lebih dulu (`@import` Google Fonts, `var(--font-*)`, dan
     `mix-blend-mode` dibuang), lalu sisa SVG diperiksa keamanannya;
   - ditolak bila ada `DOCTYPE/ENTITY`, `<script>`, `on*`, `javascript:`, `url()`/`href`
     eksternal, `foreignObject`/iframe/object/embed, atau data-URI HTML/SVG;
   - rasio wajib **4:5** (1080×1350; toleransi ukuran 600–2160 × 750–2700);
   - slot wajib: `#editable-message` (grup dengan contoh teks),
     `#editable-footer`, dan `#editable-user` + `#editable-time` **atau** grup
     `#editable-meta` (dua `<text>` pertama = handle, waktu);
   - geometri diukur lewat `scripts/measure-templates.mjs` (file sementara di OS temp);
   - palette diturunkan lewat `scripts/template-meta.mjs`;
   - checksum = SHA-256 dari SVG ternormalisasi.
3. Resolve `base_handle` → `Base.id` (kosong = bersama). Base tidak ditemukan → 422
   `BASE_NOT_FOUND` dengan error field `base_handle`.
4. Tentukan `sortOrder` (default: `max(sortOrder) + 10`).
5. Render halaman 1 lewat `CanvasService.renderTemplateThumbnail`, resize ke lebar **540px**
   dengan `sharp`, upload ke Supabase Storage.
6. Simpan baris + audit `TEMPLATE_CREATED` dalam satu transaksi.
7. Invalidate cache `template:` supaya katalog publik langsung berubah.

Thumbnail tidak pernah dibuat dari gambar eksternal: selalu dari SVG yang tersimpan.

### 4.1 Path thumbnail

```
templates/<key>-v<version>.png
```

- Versi baru = path baru, sehingga cache CDN/browser tidak menyajikan gambar lama.
- Render ulang tanpa ganti versi menulis file yang sama, lalu URL di DB diberi
  `?rev=<timestamp>` sebagai cache-buster.
- Ganti SVG dengan isi yang sama (checksum sama) **tidak** menaikkan versi dan tidak
  merender ulang thumbnail.

### 4.2 Audit

Semua aksi menulis `SystemLog` lewat `AdminSecurityService.writeAudit`:

| Action | Kapan |
| --- | --- |
| `TEMPLATE_CREATED` | Import baru |
| `TEMPLATE_UPDATED` | Ubah label/deskripsi/kategori/status/urutan/pemilik |
| `TEMPLATE_SVG_REPLACED` | Ganti SVG (mencatat versi & checksum lama/baru) |
| `TEMPLATE_THUMBNAIL_REGENERATED` | Render ulang thumbnail |
| `TEMPLATE_ARCHIVED` | Arsipkan template |

Metadata menyimpan `base_handle` sebelum/sesudah agar perpindahan pemilik dapat dilacak.

---

## 5. API

### 5.1 Admin (Super Admin)

| Method | Path | Body | Keterangan |
| --- | --- | --- | --- |
| `GET` | `/api/admin/templates` | — | Semua status, termasuk arsip. |
| `POST` | `/api/admin/templates` | `{ key, svg, label?, description?, category?, status?, sort_order?, base_handle? }` | Import + thumbnail otomatis. `status` = `draft`/`active`. |
| `PATCH` | `/api/admin/templates/:key` | salah satu dari `label`, `description`, `category`, `status`, `sort_order`, `base_handle` | `base_handle: null` mengembalikan ke katalog bersama. |
| `PUT` | `/api/admin/templates/:key/svg` | `{ svg }` | Ganti desain; versi naik hanya bila checksum berubah. |
| `POST` | `/api/admin/templates/:key/thumbnail` | — | Render ulang thumbnail tanpa ganti versi. |
| `DELETE` | `/api/admin/templates/:key` | — | Arsipkan (bukan hard delete). Pulihkan lewat `PATCH status`. |

Auth: `requireAuth` + `requireRole('Super Admin')`. Import/ganti SVG/render thumbnail dibatasi
20 request/menit per user+IP memakai `RateLimitService` (bucket Postgres), bukan rate limiter
in-memory.

Response admin memakai **snake_case**, misalnya:

```json
{
  "id": "tpl_...",
  "key": "13-papan-kampus",
  "label": "Papan Kampus",
  "status": "draft",
  "version": 1,
  "base_id": null,
  "base_handle": null,
  "base_name": null,
  "thumbnail_url": "https://.../templates/13-papan-kampus-v1.png",
  "slots_summary": {
    "max_lines": 10,
    "has_quote": true,
    "has_user": true,
    "has_time": true,
    "has_footer": true,
    "warnings": []
  }
}
```

`svgSource` dan `slots` mentah tidak dikirim ke frontend. Frontend hanya menampilkan
thumbnail dan ringkasan.

### 5.2 Publik (composer)

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET` | `/api/templates` | Hanya katalog bersama (`baseId = null`). |
| `GET` | `/api/templates?base_handle=@base` | Template milik base itu (di urutan depan) + katalog bersama. |
| `GET` | `/api/templates/:key?base_handle=@base` | Detail, discope ke base. |

Tanpa `base_handle`, template milik base lain **tidak pernah** terkirim. `base_handle`
yang tidak ada → 404 `BASE_NOT_FOUND`.

### 5.3 Validasi saat membuat fess

`FessService.resolveTemplateKey(raw, baseId)`:

- Key legacy (`constants/templates.ts`) tetap diterima untuk kompatibilitas fess lama.
- Key DB harus `status = active` **dan** `baseId` kosong atau sama dengan base tujuan.
- Jika tidak valid → 422 `VALIDATION_ERROR` dengan
  `errors.template = "Template <key> tidak tersedia untuk base ini"`.

Ini mencegah user memakai key template milik base lain meskipun menebak key-nya.

`POST /api/fesses/canvas/preview` memakai resolver yang sama sebelum merender gambar.
Pratinjau untuk base yang tidak ada → 404 `NOT_FOUND`; template draft/arsip atau milik
base lain → 422 `VALIDATION_ERROR`. Tanpa ini, endpoint pratinjau bisa membocorkan
tampilan template eksklusif base lain walau tidak menyimpan data.

---

## 6. Perilaku katalog

Contoh: base A punya `13-papan-kampus`, base B punya `14-kartu-b`, dan ada 12 template
bersama.

| Pemanggil | Yang diterima |
| --- | --- |
| `GET /api/templates` | 12 template bersama |
| `GET /api/templates?base_handle=@a` | `13-papan-kampus` + 12 bersama |
| `GET /api/templates?base_handle=@b` | `14-kartu-b` + 12 bersama |
| Composer base A memilih `14-kartu-b` | Ditolak 422 |
| Fess lama memakai `13-papan-kampus` | Tetap dirender (renderer tidak mengecek pemilik) |

Composer (`templateStore`) menyimpan cache per `base_handle`. Saat base berubah, pilihan
template yang tidak tersedia di scope baru otomatis diganti template acak yang valid.

---

## 7. Frontend

- Halaman: `frontend/src/views/super-admin/TemplatesPage.vue`
- Route: `/super-admin/templates` (`SuperAdminTemplates`)
- Navigasi: “Template Kartu” di `SuperAdminLayout.vue`
- API client: `frontend/src/api/index.js`
  (`getAdminTemplates`, `createAdminTemplate`, `updateAdminTemplate`,
  `replaceAdminTemplateSvg`, `regenerateAdminTemplateThumbnail`, `archiveAdminTemplate`)
- Katalog user: `frontend/src/stores/templateStore.js` (`loadForBase`, cache per base)
- Pemilih composer: `frontend/src/components/compose/TemplateModal.vue` (prop `baseHandle`)

Fitur UI:

- Statistik total/aktif/draft/khusus base.
- Filter pencarian, status, pemilik, kategori.
- Import SVG via klik atau drag-and-drop (validasi ekstensi & 2MB di klien).
- Edit metadata, status, urutan, dan pemilik base.
- Ganti SVG dengan peringatan versi.
- Render ulang thumbnail.
- Pratinjau besar + ringkasan slot/checksum.
- Arsipkan dengan konfirmasi.

Tidak ada warna hex langsung di komponen; semua memakai variabel `src/style.css`.

---

## 8. Test

| File | Cakupan |
| --- | --- |
| `backend/tests/template-admin.util.test.ts` | Key valid/reserved, keamanan SVG, rasio 4:5, slot wajib, batas 2MB, dan seluruh 12 template resmi di `assets/templates/`. |
| `backend/tests/template-admin.service.test.ts` | Create (bersama/base), base tidak ditemukan, update pemilik, aktivasi tanpa thumbnail, replace versi sama/berubah, regenerate + cache-buster, archive idempoten, audit. |
| `backend/tests/template-resolution.test.ts` | Resolusi template per base, penolakan milik base lain, `listActive` vs `listActiveForBase`. |
| `backend/tests/canvas.preview.test.ts` | Pratinjau composer menolak base tidak ada, template draft, dan template milik base lain; template aktif sendiri/bersama tetap dirender. |

Jalankan:

```bash
cd backend
npx vitest run tests/template-admin.util.test.ts tests/template-admin.service.test.ts tests/template-resolution.test.ts
```

---

## 9. Deploy & runtime

- `backend/vercel.json` menambahkan `scripts/measure-templates.mjs` dan
  `scripts/template-meta.mjs` ke `includeFiles`. Tanpa ini, import/measure gagal di Vercel.
- Body JSON dibatasi 15MB; SVG dibatasi 2MB di service. SVG dikirim sebagai string JSON,
  bukan multipart.
- Migrasi ownership **additive** (kolom nullable + index + FK `SET NULL`). Tetap jalankan
  `npx prisma migrate status` sebelum `migrate deploy` di produksi.
- Kode baru aman bila migrasi belum jalan? Tidak sepenuhnya: query `Template.baseId` akan
  gagal. Karena itu urutan produksi: apply migrasi dulu, baru deploy kode.
- Jangan mengubah `.env*` tanpa persetujuan. Script `prisma:*` tanpa suffix `:dev` membaca
  `.env` produksi.

---

## 10. Rencana lanjutan (belum diimplementasikan)

### 10.1 Recolor mengikuti warna base

`Template.palette` sudah menyimpan `{ bg, ink, accent }` hasil turunan SVG, tetapi belum
dipakai untuk mengganti warna. Recolor otomatis membutuhkan aturan desain:

- penandaan elemen mana yang `primary`, `secondary`, `accent`, dan mana yang harus tetap;
- kontras teks yang aman untuk setiap kombinasi;
- kemungkinan override manual per template.

Karena itu recolor sengaja ditunda. Arah yang disarankan: simpan `paletteRole` per elemen
atau tambahkan lapisan warna di renderer, bukan menambal string SVG secara membabi buta.

### 10.2 Template milik user (dibeli, dipakai lintas base)

Kepemilikan saat ini adalah `Template.baseId` (milik base). Untuk user pribadi perlu model
terpisah, misalnya:

```prisma
model UserTemplate {
  userId     String
  templateId String
  acquiredAt DateTime @default(now())
  source     String   // 'purchase' | 'reward' | 'grant'
  orderId    String?
  @@unique([userId, templateId])
}
```

Poin yang perlu diputuskan sebelum implementasi:

- harga & mata uang (CTF atau uang nyata lewat Midtrans);
- apakah template user otomatis terlihat di semua base atau harus diaktifkan per base;
- refund/revoke dan dampak ke fess yang sudah terbit;
- batas jumlah template per base dan prioritas urutan saat digabung dengan katalog base.

### 10.3 Penugasan 12 template bersama

Saat ini 12 template lama tetap `baseId = null`. Super Admin dapat menugaskannya kapan saja
lewat Edit → Pemilik. Setelah ditugaskan, template tersebut hilang dari katalog bersama dan
hanya terlihat oleh base pemiliknya. Tidak ada batas jumlah yang dipaksakan.

### 10.4 Lain-lain

- Bulk assign/import (saat ini satu per satu).
- Preview hasil render penuh (bukan hanya halaman 1) sebelum aktivasi.
- Version history/rollback desain (saat ini versi hanya penanda cache).
- Batas kuota template per base sebagai konfigurasi, bukan angka hardcode.

---

## 11. Peta file

| File | Peran |
| --- | --- |
| `backend/prisma/schema.prisma` | `Template.baseId` + relasi `Base.templates`. |
| `backend/prisma/migrations/20261028010000_template_base_ownership/` | Migrasi ownership. |
| `backend/src/utils/template-admin.util.ts` | Validasi keamanan, ukur, palette, checksum, key. |
| `backend/src/services/template-admin.service.ts` | Create/update/replace/regenerate/archive, thumbnail, audit. |
| `backend/src/controllers/template-admin.controller.ts` | Handler HTTP admin. |
| `backend/src/validators/template-admin.validator.ts` | Skema Zod. |
| `backend/src/routes/admin.routes.ts` | Mount `/admin/templates` + rate limit. |
| `backend/src/services/template.service.ts` | Baca per base + cache + `TemplateRecord.baseId`. |
| `backend/src/controllers/template.controller.ts` | Listing publik ber-scope `base_handle`. |
| `backend/src/services/fess.service.ts` | Validasi template saat membuat fess. |
| `frontend/src/views/super-admin/TemplatesPage.vue` | Konsol import/kelola. |
| `frontend/src/stores/templateStore.js` | Cache katalog per base. |
| `frontend/src/components/compose/TemplateModal.vue` | Pemilih template ber-scope. |
