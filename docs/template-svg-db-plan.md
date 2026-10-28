# Rencana: Template Card SVG Berbasis Database (Single Source of Truth)

Status: **Fase 0–4 selesai dan sudah live di produksi. Kelola template berikutnya lewat
konsol Super Admin, bukan script.**
Target: mengganti 38 template hardcoded dengan 12 desain SVG di `template-card/`,
disimpan di database, dengan satu sumber kebenaran untuk backend & frontend.

> **Kelola template sekarang lewat UI.**
> Import SVG, thumbnail otomatis, versi, arsip, dan kepemilikan per base dilakukan di
> `/super-admin/templates`. Dokumentasi lengkap: [`template-admin-console.md`](./template-admin-console.md).
> Dokumen ini tetap menjadi acuan renderer, geometri, dan normalisasi SVG.

Implementasi saat ini:

- 12 SVG ada di `backend/assets/templates/` (sudah dinormalisasi & diukur saat import).
- Tabel `Template` + migration `20261028000000_template_model` sudah diterapkan di DB dev & produksi.
- `scripts/import-templates.mjs` mengisi 12 baris (idempotent, `checksum` stabil). Script ini
  hanya untuk bootstrap; import berikutnya lewat konsol admin.
- `Template.baseId` (migration `20261028010000_template_base_ownership`) menandai template
  eksklusif milik satu base; `null` = katalog bersama.
- Renderer ada di `CanvasService.buildPages()` / `buildSvgTemplatePages()`.
- `GET /api/templates` & `GET /api/templates/:key` sudah aktif, dengan scope `?base_handle=`.
- Fallback ke renderer lama tetap hidup untuk 38 template lama & key tak dikenal.

---

## 1. Hasil analisis `template-card/`

12 file SVG, semuanya konsisten secara struktur (hasil ekstraksi):

| File | Ukuran | Slot yang ada | Font isi | Posisi isi |
| --- | ---: | --- | ---: | --- |
| `01-helpdesk-ticket.svg` | 54 KB | user, time, message, footer | 46 | `translate(252 616)` |
| `02-network-map.svg` | 52 KB | meta, message, footer | 46 | `translate(148 632)` |
| `03-exam-omr.svg` | 58 KB | meta, message, footer | 44 | `translate(348 520)` |
| `04-sticky-note.svg` | 49 KB | user, time, message, footer | 50 | `translate(148 520)` |
| `05-campus-catalog.svg` | 52 KB | user, time, message, footer | 44 | `translate(276 520)` |
| `06-noticeboard.svg` | 51 KB | meta, message, footer | 48 | `translate(140 656)` |
| `07-student-id.svg` | 51 KB | user, time, message, footer | 42 | `translate(444 664)` |
| `08-services-file.svg` | 50 KB | user, time, message, footer | 46 | `translate(184 736)` |
| `09-campus-daily.svg` | 51 KB | meta, message, footer | 44 | `translate(380 636)` |
| `10-campus-transit.svg` | 51 KB | user, time, message, footer | 46 | `translate(136 520)` |
| `11-cassette-mixtape.svg` | 50 KB | meta, message, footer | 44 | `translate(272 744)` |
| `12-lab-report.svg` | 51 KB | meta, message, footer | 46 | `translate(188 596)` |

### Struktur yang dipakai semua file

1. Kanvas tetap **1080×1350** (4:5 portrait saja). Tidak ada varian 1:1 atau 9:16.
2. `<defs>` berisi `<pattern>` dengan id ber-namespace per file (`grid-01`, `dashedGrid-01`,
   `corkDots-04`, …) + satu tile `grain-01` berisi **PNG base64** (± 40 KB dari total 50 KB).
3. `<style>` di dalam `<defs>`: `@import` Google Fonts + 4 kelas (`display`, `sans`, `mono`, `serif`)
   yang **semuanya** resolve ke Poppins lewat `var(--font-sans, 'Poppins', sans-serif)`.
4. Slot konten ditandai id tetap:
   - `#editable-user` + `#editable-time` (**6 file**) — desain bergaya formulir/tiket.
   - `#editable-meta` (**6 file**) — satu baris meta gabungan, tanpa user/time terpisah.
   - `#editable-message` — `<g>` berisi **tepat 4 baris** contoh; `y` baris terakhir 176–207.
   - `#editable-footer` — teks footer, default `dikirim lewat myfess.id`.
5. Fitur SVG yang dipakai: `<pattern>`, `<image>` data-URI, `<clipPath>` tidak ada,
   `<filter>` **tidak ada**, gradient **tidak ada**, `<mask>`/`<textPath>`/`<foreignObject>` tidak ada.
   Yang bermasalah untuk resvg hanya dua: `@import` (remote) dan `style="mix-blend-mode:multiply"`
   pada rect grain.

### Konsekuensi teknis

- `@import` tidak akan pernah jalan di resvg → wajib dibuang saat import.
- `var(--font-sans, …)` tidak diparse resvg → kelas CSS harus diganti atribut literal
  (`font-family="Poppins" font-weight="800"`), hasil visual tetap sama karena semua kelas = Poppins.
- `mix-blend-mode` perlu diverifikasi terhadap resvg; jika tidak didukung, grain dirender
  dengan opacity saja atau dibuang (dampak visual kecil).
- Area isi hanya 4 baris → butuh strategi multi-halaman (lihat §6).
- `template-card/` berada di **root folder yang bukan git repo**. Folder ini tidak ikut
  version control dan tidak akan pernah ter-deploy. Wajib dipindahkan ke dalam `backend/`.

---

## 2. Masalah yang diselesaikan

Saat ini ada **tiga** sumber kebenaran visual, dan ketiganya harus cocok manual:

| Lokasi | Peran | Ukuran |
| --- | --- | --- |
| `backend/src/constants/templates.ts` | data 38 template (warna, pattern, panel, typography) | ± 1.100 baris |
| `backend/src/services/canvas.service.ts` | renderer SVG manual + 10 cabang `if (template.key === …)` | 1.444 baris |
| `frontend/src/config/templates.js` | duplikat data + thumbnail CSS | ± 1.200 baris |
| `frontend/src/utils/cardPagination.js` | **cermin** `layoutText`/`paginate`/`buildQuoteBlock` backend | ± 400 baris |

Akibatnya: pratinjau composer bisa berbeda dari PNG yang diposting, dan setiap template
baru harus diedit di dua tempat. Komentar di `cardPagination.js` sendiri mengakui ini
("cermin dari … backend").

Total kode duplikat yang bisa dihapus: **± 2.400 baris** (`templates.js` 1.200 +
`cardPagination.js` 400 + `PostPreview.vue` 841).

Tujuan akhir: **hanya backend yang tahu cara menggambar**. Frontend hanya menampilkan
gambar hasil render backend dan metadata dari API.

---

## 3. Keputusan arsitektur

**Template disimpan di Postgres (Prisma), SVG asli sebagai payload, geometri slot sebagai JSON.
Renderer hanya di backend. Frontend tidak menyimpan geometri/template apa pun.**

Alasan memilih render di backend (bukan SVG di browser):

- Satu-satunya output yang benar-benar penting adalah PNG/JPEG yang dikirim ke Instagram.
  Kalau pratinjau dirender browser, kita kembali punya dua renderer (resvg vs Chromium)
  dan duplikasi pembungkusan teks.
- Slot `editable-message` butuh pengukuran font + paginasi; logika itu sudah ada di backend
  (`measureTextWidth`, `layoutText`, `paginate`) dan akan diekstrak jadi modul bersama.
- Thumbnail grid tetap ringan karena berupa PNG yang sudah jadi (bukan 12 SVG 50 KB).

Konsekuensi yang diterima: pratinjau live di composer menjadi request server
(debounce + cache). Lihat §7 untuk mitigasi performa.

---

## 4. Skema database

Model baru di `backend/prisma/schema.prisma`:

```prisma
model Template {
  id           String   @id @default(cuid())
  key          String   @unique              // 'helpdesk-ticket', 'network-map', …
  label        String
  description  String?
  category     String   @default("campus")
  renderer     String   @default("svg")      // 'svg' | 'legacy'
  aspect       String   @default("portrait")
  width        Int      @default(1080)
  height       Int      @default(1350)

  svgSource    String   @db.Text             // SVG ternormalisasi, masih berisi teks contoh
  slots        Json                          // geometri slot (lihat di bawah)
  palette      Json?                          // warna dominan untuk UI (accent/bg/ink)
  thumbnailUrl String?                        // PNG contoh di Supabase Storage
  checksum     String?                        // sha256 svgSource, untuk deteksi drift
  version      Int      @default(1)

  status       String   @default("active")    // draft | active | archived
  sortOrder    Int      @default(0)
  createdById  String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([status, sortOrder])
}
```

Bentuk `slots` (contoh `01-helpdesk-ticket`, angka hasil ukur nyata):

```json
{
  "anchor":  { "x": 252, "y": 616,
               "matrix": [1, 0, 0, 1, 252, 616], "rotated": false },
  "message": { "x": 0, "y": 0, "maxWidth": 628, "fontSize": 46,
               "lineHeight": 63, "lineRatio": 1.3696, "maxLines": 6,
               "weight": 700, "letterSpacing": -0.4, "fill": "#14245D",
               "anchor": "start", "bottom": 366,
               "widthSource": "panel", "bottomSource": "panel" },
  "user":    { "x": 220, "y": 434, "fontSize": 24, "weight": 700,
               "fill": "#14245D", "maxWidth": 260, "anchor": "start" },
  "time":    { "x": 592, "y": 434, "fontSize": 22, "weight": 600,
               "fill": "#14245D", "maxWidth": 340, "anchor": "start" },
  "footer":  { "x": 478, "y": 1124, "fontSize": 22, "weight": 600,
               "fill": "#14245D", "anchor": "middle" },
  "quote":   { "x": 0, "y": 166, "width": 550, "maxLines": 3,
               "fontSize": 29, "lineHeight": 40,
               "padq": 18, "header": 48, "foot": 14, "height": 200, "rx": 16,
               "fill": "rgba(20,36,93,0.06)", "stroke": "#14245D",
               "strokeWidth": 1.5, "ink": "#14245D",
               "muted": "rgba(20,36,93,0.65)", "accent": "#FF5A26",
               "showAvatar": true, "showTime": true, "pillLabel": "Kutip" },
  "avatar":  null
}
```

**Dua ruang koordinat — jangan dicampur:**
- `user`, `time`, `meta`, `footer` disimpan **absolut** (persis seperti di SVG).
- `message` dan `quote` disimpan **lokal terhadap `anchor`** (`message.x = message.y = 0`),
  karena template 04 & 05 merotasi seluruh kartu (`rotate(-1.4)`). Renderer menggambar
  keduanya di dalam `<g transform="matrix(anchor.matrix)">`, jadi hasilnya tetap mengikuti
  kemiringan desain.

`message.bottom` = jarak dari anchor ke batas bawah area teks, sudah dikurangi `SAFE_PAD`,
dipakai menghitung `maxLines` dan posisi `quote.y`. Detail frame kutipan di §6.2.

Catatan:
- `avatar` = `null` untuk 12 desain ini (tidak ada slot avatar; desain punya ikon dekoratif).
  Bila nanti perlu, tambahkan `#editable-avatar` di SVG dan isi slot-nya.
- `maxWidth` diturunkan dari pengukuran 4 baris contoh + margin; bukan angka karangan.
- `Fess.template` tetap `String` (bukan FK) supaya fess lama tidak pecah. Validasi ke DB
  dilakukan di service, bukan di Zod enum.

`SystemSetting` yang sudah ada **tidak** dipakai untuk ini — butuh listing, urutan,
versioning, dan status per baris, yang tidak cocok dengan key-value tunggal.

---

## 5. Normalisasi SVG saat import

Script `backend/scripts/import-templates.mjs` (dijalankan manual, bukan runtime):

1. Baca semua `backend/assets/templates/*.svg`.
2. **Buang** blok `<style>…</style>` (menghilangkan `@import` dan `var()`).
3. Ganti kelas CSS menjadi atribut literal pada setiap elemen:
   - `class="display"` → `font-family="Poppins" font-weight="800" letter-spacing="-0.02em"`
   - `class="sans"` → `font-family="Poppins"`
   - `class="mono"` → `font-family="Poppins" font-feature-settings="'tnum' 1"` (abaikan jika resvg tidak parse)
   - `class="serif"` → `font-family="Poppins"` (memang begitu di file aslinya)
4. Tangani `style="mix-blend-mode:multiply"` pada rect grain: coba render; jika resvg
   mengabaikan, hapus atributnya dan naikkan `opacity` agar bobot visual setara.
5. Ekstrak geometri `#editable-*` (x/y dari `transform` + atribut font) → `slots`.
   `maxWidth` dihitung dari lebar area dekoratif template, bukan dari teks contoh.
6. Validasi (gagal import bila dilanggar): tidak ada `@import`, `var(`, `href` non-data,
   `<filter>`, `<foreignObject>`; semua id unik; 4 baris contoh pada `editable-message`.
7. Render PNG contoh 1080×1350 → perkecil ke 540×675 (PNG palette, ±40–75 KB) →
   upload Supabase Storage `templates/<key>-v<n>.png` → `thumbnailUrl`
   (`npm run template:thumbnails:*`, lihat Fase 4b).
8. Upsert by `key`, simpan `checksum`; jika checksum berubah, `version + 1` dan thumbnail baru.

`backend/prisma/seed.ts` **ada di git HEAD tetapi terhapus di working tree** (status `D`,
perubahan belum di-commit milik user — jangan dipulihkan/di-commit tanpa izin).
`npm run prisma:seed` karena itu gagal saat ini. Import template **tidak** bergantung pada file
itu: gunakan `npm run template:import:dev` (lihat Fase 1).

---

## 6. Alur render baru

Renderer ditempatkan di `CanvasService` (`buildPages()` → `buildSvgTemplatePages()`),
bukan di service terpisah. Alasannya: `layoutText`, `paginate`, `renderTextLines`,
`measureTextWidth`, dan `buildSvgQuoteFrame` adalah fungsi privat yang sudah dipakai
renderer lama; memindahkannya ke util berisiko mengubah output 38 template lama.
`buildSvgTemplatePages` hanya menambah lapisan "template dari DB" di atas fungsi yang sama,
jadi tidak ada mesin layout kedua.

```
buildPages(fess, templateKey, aspectKey)
  → TemplateService.getByKey(key)
  → renderer === 'svg' ? buildSvgTemplatePages() : buildSvgPages() (legacy)
```

Langkah `buildSvgTemplatePages`:
1. `slots` dibaca dari baris DB (hasil ukur `scripts/measure-templates.mjs`).
2. Ganti isi `#editable-user` / `#editable-meta` / `#editable-time` di tempat (transform
   grup dipertahankan). `#editable-footer` diganti **host frontend** dari `FRONTEND_URL`
   (mis. `fessncurious.vercel.app`, `fessncurious-dev.vercel.app`, atau `localhost:5173`
   saat lokal) — bukan `dikirim lewat myfess.id` — dan dijepit `fitTextToWidth` sesuai
   `text-anchor` + lebar kartu. Handle base tidak diulang di footer karena sudah tampil
   di slot `@user`.
3. Paginasi memakai `layoutText` + `paginate` yang sudah ada. Kapasitas baris diturunkan
   dari `slots.message.bottom` dan (bila ada kutipan) `slots.quote.y − QUOTE_GAP`.
4. Grup `#editable-message` **dibuang**, lalu teks hasil layout ditempel di akhir dokumen
   di dalam `<g transform="matrix(anchor.matrix)">`. Ini wajib untuk template 04/05 yang
   memutar seluruh kartu; koordinat slot karenanya **lokal ke anchor**.
5. `totalPages > 1`: badge `i/n` berupa pill gelap + teks putih di kanan bawah (kontras aman
   di template berlatar gelap/cokelat seperti 06).
6. `renderSvgToPng` / `renderSvgToJpeg` yang sudah ada dipakai apa adanya.

**Kompatibilitas:** `getTemplateByKey()` diubah menjadi:
1. cari di DB (`status = active`), lalu
2. fallback ke `constants/templates.ts` + jalur `buildSvgPages` lama bila `renderer = 'legacy'`.

Dengan begitu 38 template lama tetap bisa merender fess lama, sementara 12 template baru
memakai jalur SVG. Penghapusan jalur legacy dilakukan belakangan (Fase 6) setelah
dipastikan tidak ada fess aktif dengan key lama.

**Keputusan (disetujui): kutipan dirender sebagai kotak ber-frame di dalam area message.**
Tidak perlu mengedit 12 SVG — frame digambar renderer, dan ruangnya dicadangkan lewat
`slots.quote`. Detail di §6.2.

### 6.1 Paginasi & carousel — tetap berjalan, tapi kapasitas menyusut

Paginasi dan perakitan carousel **tidak berubah** karena keduanya logika backend yang
independen dari template:

```
layoutText() → paginate(lines, firstCap, restCap, MAX_PAGES=10)   // canvas.service.ts:640
             → buildSvgPages() → 1 SVG per halaman
             → renderSvgToJpeg() per halaman → upload Supabase
             → arrangeCarouselItems(cardItems + mediaItems, carouselOrder)
             → .slice(0, 10) → carousel Instagram                     // :258-271
```

Yang berubah hanya **kapasitas baris per halaman**, karena area `#editable-message` pada
12 desain jauh lebih kecil daripada area teks renderer sekarang:

| | Renderer sekarang | 12 template baru |
| --- | --- | --- |
| Awal teks (`message.y`, absolut) | 251 | **520–744** |
| Batas bawah area teks (absolut) | ~1222 | **788–1100** |
| Kapasitas baris / halaman | **± 13** | **4–7** |

Angka final per template ada di §6.2.3 (tabel hasil ukur). Ringkasnya `restLn` = 4 (02),
5 (03, 08, 10), 6 (01, 05, 09, 11), 7 (04, 06, 07, 12) — semuanya dari pengukuran
`scripts/measure-templates.mjs`, bukan perkiraan, dan disimpan di kolom `slots` saat import.

**Dampak:** fess yang sekarang muat 3–4 halaman menjadi 6–10 halaman. Karena batas carousel
Instagram 10 slide dan media user ikut memakan slot, fess panjang lebih cepat terkena
pemotongan `…`.

**Dampak:** fess yang sekarang muat 3–4 halaman menjadi 6–10 halaman. Karena batas carousel
Instagram 10 slide dan media user ikut memakan slot, fess panjang lebih cepat terkena
pemotongan `…`.

**Mitigasi wajib di Fase 2** — ganti pemilihan ukuran font. Sekarang
`canvas.service.ts:613-644` memakai tier tetap `[50,42,35,31]` lalu memilih tier terbesar
yang muat ≤ `MAX_PAGES`. Untuk template SVG, tier harus **diturunkan dari ukuran font desain**
template (46/44/50 dari SVG), bukan angka tetap:

```ts
// slots.message.fontSize = ukuran desain (mis. 46)
const tiers = [1.0, 0.86, 0.74, 0.64].map((s) => Math.round(designSize * s));
// lalu loop yang sama: layoutText → paginate → break bila !truncated
```

`lineHeight` dan `maxLines` ikut diskalakan memakai **rasio hasil ukur** per template
(`slots.message.lineRatio` = `lineHeight / fontSize` dari SVG, nilainya 1,3696–1,4048 — bukan
konstanta 1,37):

```ts
const fontSize = Math.round(designSize * scale);
const lineHeight = Math.round(fontSize * slots.message.lineRatio);
const restCap = Math.floor((slots.message.bottom - fontSize * 0.25) / lineHeight) + 1;
```

**Batas keras yang harus dijaga:**
- `MAX_PAGES = 10` (batas carousel Instagram) tetap.
- Bila masih terpotong di tier terkecil → tambahkan `…` seperti sekarang (`:648-658`).
- Kutipan memakan kapasitas halaman 1 → `firstCap < restCap`; hitungan ini sudah ada di
  renderer lama dan harus direplikasi untuk slot baru.

**Test yang menangkap regresi ini:** `tests/template-renderer.test.ts` wajib menguji
(a) konten 1 baris → 1 halaman, (b) konten ~30 baris → multi-halaman, (c) konten sangat
panjang → tepat 10 halaman + `…`, untuk **setiap** template (kapasitasnya beda-beda).

### 6.2 Slot kutipan ber-frame (`slots.quote`)

Kutipan (fess yang di-quote) digambar sebagai kotak ber-frame di **bagian bawah area
message**, bukan mengikuti baris terakhir teks. Posisi tetap per template supaya selalu
selaras dengan desain.

**Kenapa frame digambar renderer, bukan ditambahkan ke SVG:** menambah `<g id="editable-quote">`
ke 12 file berarti mengedit 12 desain manual dan mengunci posisinya. Dengan menggambar di
renderer, geometri cukup disimpan sebagai angka di `slots.quote`, dan bisa dikoreksi lewat
admin tanpa menyentuh file SVG.

Bentuk `slots.quote` (diisi import script, bukan manual). Semua koordinat **lokal terhadap
`anchor`**, bukan absolut:

```json
{
  "x": 0, "y": 166, "width": 550,
  "maxLines": 3, "fontSize": 29, "lineHeight": 40,
  "padq": 18, "header": 48, "foot": 14, "height": 200,
  "rx": 16, "fill": "rgba(20,36,93,0.06)", "stroke": "#14245D", "strokeWidth": 1.5,
  "ink": "#14245D", "muted": "rgba(20,36,93,0.65)", "accent": "#FF5A26",
  "showAvatar": true, "showTime": true, "pillLabel": "Kutip"
}
```

#### 6.2.1 Semua angka diturunkan dari SVG (tidak ada tabel manual)

Pengukuran ada di `scripts/measure-templates.mjs` dan dipakai ulang oleh
`scripts/import-templates.mjs`. Sumber sinyal:

| Sinyal SVG | Menjadi |
| --- | --- |
| `<g id="editable-message">` → `transform`, `font-size`, `font-weight`, `letter-spacing`, `fill` | `anchor.matrix`, `message.fontSize/weight/letterSpacing/fill` |
| jarak antar `<text>` contoh (median) | `message.lineHeight` |
| rect terkecil yang memuat anchor pesan | panel → batas kanan & bawah |
| garis horizontal (`path`/`line`, lebar ≥ 120) yang dimulai dari kiri kolom & berada di bawah contoh | batas kolom & batas bawah |
| blok non-garis di bawah teks yang menutupi ≥ 60% lebar kolom (pill footer, kotak tanda tangan) | batas bawah |
| teks `text-anchor="end"` | margin kanan |
| lebar baris contoh via `opentype.js` + `fonts/Poppins-Bold.ttf` | validasi `maxWidth` |
| ornamen ber-`transform` (cap, ikon, jam pasir) | `obstacles[]` untuk penghindar kutipan |

Dua hal yang wajib diingat saat mengubah pengukur:

1. **Koordinat lokal, bukan absolut.** Template 04 & 05 membungkus seluruh kartu dengan
   `rotate(-1.4 …)`. Mengukur di ruang absolut membuat `bottom` meleset ~22 px (kotak
   kutipan menembus pembatas). Karena itu matriks grup pesan di-invert lebih dulu
   (`invertMatrix`), semua geometri diukur di ruang lokal yang axis-aligned, dan rotasi
   disimpan di `anchor.matrix` untuk renderer.
2. **`\bwidth` juga cocok dengan `stroke-width`.** Regex atribut wajib `(?:^|\s)name=`
   (sudah diperbaiki; kalau tidak, semua `rect` terbaca berukuran 0).

#### 6.2.2 Rumus final

```
SAFE_PAD = 40, QUOTE_GAP = 26, MIN_FIRST_LINES = 3, MAX_QUOTE_LINES = 4
MIN_QUOTE_WIDTH = 260

bottom        = min(panel.bottom, garis-penutup, blok-lebar) − SAFE_PAD
maxWidth      = (columnRight − msgX) − SAFE_PAD          // minimal selebar baris contoh
quoteFont     = max(18, round(message.fontSize × 29/46))
padq/header/lineHeight/foot = round(quoteFont × 18/29, 48/29, 40/29, 14/29)
quoteHeight(n)= padq + header + n×lineHeight + foot
quote.y       = bottom − quoteHeight(n)
firstCap(n)   = floor((quote.y − QUOTE_GAP − 0.25×fontSize − msgY) / lineHeight) + 1
maxLines      = n terbesar (1..4) dengan firstCap(n) ≥ 3
```

Rasio metrik kutipan diturunkan dari `buildQuoteBlock()` lama (font 29 → 18/48/40/14),
jadi proporsi visualnya identik dengan renderer sekarang di template mana pun.

**Fallback bila tidak ada n yang memberi `firstCap ≥ 3`:**
- Coba kecilkan font kutipan bertahap `[1, 0.92, 0.85, 0.78]`.
- Bila pengecilan **tidak menambah** baris isi fess (kasus 02), jangan dikecilkan tanpa
  manfaat: pakai font penuh dan `maxLines` = n terbesar dengan `firstCap ≥ 2`.
- Flag `kutipan-menyempit` dicatat agar bisa ditinjau, bukan disembunyikan.

**Penghindaran ornamen** (cap "OPEN" 05, ikon wifi 09, jam pasir 12): ornamen dianggap
penghalang bila menutupi **≥ 50% tinggi kotak kutipan dan ≥ 40 px**. Kotak lalu dipersempit
ke `ornament.x1 − msgX − SAFE_PAD`, asalkan hasilnya ≥ `MIN_QUOTE_WIDTH`; kalau tidak,
ornamen dibiarkan tertimpa (keterbacaan lebih penting). Flag:
`kutipan-menghindari-ornamen-<tag>` / `ornamen-terlalu-dekat`.

#### 6.2.3 Hasil ukur 12 template

Semua nilai lokal terhadap `anchor` (`quote.x` selalu 0 karena sejajar tepi kiri teks).
`qMax`/`q1st` = baris kutipan / baris isi fess di halaman 1; `restLn` = kapasitas halaman 2+.

| Template | `anchor` | rot | `fs`/`lh` | `maxW` | `bottom` | `restLn` | `qFs` | `qMax` | `q.y` | `q.h` | `q.w` | `q1st` | catatan |
| --- | --- | :-: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 01 helpdesk-ticket | 252,616 | – | 46/63 | 628 | 366 | 6 | 29 | 3 | 166 | 200 | 550 | 3 | hindari ornamen |
| 02 network-map | 148,632 | – | 46/63 | 784 | 256 | 4 | 29 | 1 | 136 | 120 | 784 | 2 | menyempit |
| 03 exam-omr | 348,520 | – | 44/61 | 580 | 304 | 5 | 28 | 1 | 188 | 116 | 456 | 3 | hindari ornamen |
| 04 sticky-note | 144.3,529.6 | ya | 50/69 | 744 | 488 | 7 | 32 | 4 | 224 | 264 | 744 | 3 | |
| 05 campus-catalog | 274.4,526.5 | ya | 44/61 | 656 | 352 | 6 | 28 | 2 | 197 | 155 | 464 | 3 | hindari ornamen |
| 06 noticeboard | 140,656 | – | 48/66 | 824 | 416 | 7 | 30 | 3 | 210 | 206 | 824 | 3 | |
| 07 student-id | 444,664 | – | 42/59 | 512 | 392 | 7 | 26 | 4 | 176 | 216 | 512 | 3 | |
| 08 services-file | 184,736 | – | 46/63 | 658 | 320 | 5 | 29 | 1 | 200 | 120 | 658 | 3 | |
| 09 campus-daily | 380,636 | – | 44/61 | 612 | 360 | 6 | 28 | 3 | 166 | 194 | 448 | 3 | hindari ornamen |
| 10 campus-transit | 136,520 | – | 46/63 | 808 | 268 | 5 | 25 | 1 | 165 | 103 | 808 | 3 | font ×0.862 |
| 11 cassette-mixtape | 272,744 | – | 44/61 | 644 | 356 | 6 | 28 | 3 | 162 | 194 | 644 | 3 | |
| 12 lab-report | 188,596 | – | 46/63 | 712 | 412 | 7 | 29 | 4 | 172 | 240 | 568 | 3 | hindari ornamen |

Bukti visual: `docs/geometry-check/<key>-p1.png` (kutipan) dan `-p2.png` (tanpa kutipan),
dihasilkan `scripts/verify-geometry.mjs --dir ../template-card --out docs/geometry-check`.
Angka mentah: `docs/template-geometry.json`.

**Keputusan yang sudah disetujui (terima apa adanya):** 02, 03, 08, dan 10 hanya mendapat
1 baris kutipan; 02 hanya 2 baris isi + 1 baris kutipan di halaman 1. Kutipan yang lebih
panjang dipotong dengan `…`. Tidak ada angka yang dipaksa — semuanya hasil ukur desain.
Alternatif yang **tidak** dipakai: menurunkan `MIN_FIRST_LINES` ke 2, atau mengecilkan font
kutipan sampai `0.78` (kutipan akan terlihat lebih kecil daripada isi fess).

Perilaku render (halaman 1 saja):
1. Hitung `quoteHeight` dari jumlah baris kutipan (maks `maxLines`, sisanya `…`).
2. `firstCap`/`restCap` dari rumus di atas → `paginate(lines, firstCap, restCap, MAX_PAGES)`.
3. Gambar frame di `(quote.x, quote.y)` dengan tinggi `quoteHeight`.
4. Kutipan **tidak** diulang di halaman 2..N (perilaku sekarang: hanya halaman 1).
5. Bila `quotedFess` kosong → slot diabaikan, `firstCap = restCap`, area bawah dipakai teks.

**Logika yang diekstrak, bukan diduplikasi:** `buildQuoteBlock()` (`canvas.service.ts:1352-1444`)
dipindah ke `utils/quote-block.util.ts` dan dipakai **bersama** oleh jalur legacy dan jalur SVG.
Jangan menulis ulang.

**Edge case yang wajib ditangani:**
| Kasus | Perilaku |
| --- | --- |
| Template dengan ruang bawah sempit (02, 03, 08, 10) | `maxLines` jatuh ke 1 dan `firstCap` minimal 2; 10 mengecilkan font kutipan ke `0.862` |
| Ornamen menembus area kutipan (01, 03, 05, 09, 12) | kotak dipersempit ke tepi ornamen, minimal `MIN_QUOTE_WIDTH = 260` |
| Kutipan sangat panjang | dipotong di `maxLines` + `…` (sama seperti sekarang, `MAX_QUOTE_LINES`) |
| Kutipan + teks panjang | kutipan tetap di halaman 1, teks lanjut ke halaman 2..N |
| `quotedFess` ada tapi `content` kosong | frame tetap tampil, area teks tidak dipakai |

**Test:** `tests/quote-block.test.ts` — (a) tanpa kutipan → `firstCap == restCap`,
(b) dengan kutipan → `firstCap < restCap` dan frame berada di dalam batas template,
(c) kutipan 10 baris → dipotong ke `maxLines` + `…`, (d) render visual 12 template
dengan kutipan → tidak ada teks yang menembus frame.

---

## 7. API

| Endpoint | Akses | Fungsi |
| --- | --- | --- |
| `GET /api/templates` | publik | daftar `status=active`: key, label, description, category, renderer, aspect, width/height, palette, thumbnail_url, version, sort_order. Cache 60 s. |
| `GET /api/templates/:key` | publik | detail ringkas dengan bentuk yang sama (tanpa `svgSource`/`slots`) |
| `POST /api/fesses/canvas/preview` | publik (sudah ada) | sekarang membaca template dari DB |
| `POST /api/admin/templates` | Super Admin | buat template dari upload SVG (opsional, Fase 5) |
| `PATCH /api/admin/templates/:key` | Super Admin | ubah label/status/sortOrder/svgSource |
| `POST /api/admin/templates/:key/regenerate-thumbnail` | Super Admin | render ulang thumbnail |

`svgSource` dan `slots` **tidak** dikirim ke klien: frontend hanya menampilkan PNG hasil
render backend, jadi tidak ada alasan (dan tidak boleh) menggambar ulang kartu di browser.
Slots tetap satu sumber di database untuk renderer.

Perubahan validasi: `backend/src/validators/fess.validator.ts` sekarang memakai
`z.string().trim().min(1).max(40).optional().default('default')`; pengecekan key dilakukan
async di `FessService.resolveTemplateKey()` terhadap tabel `Template` + daftar template lama
(`constants/templates.ts`). Key asing → 422 `VALIDATION_ERROR` dengan `errors.template`.
Test `tests/validators.test.ts` sudah disesuaikan.

**Mitigasi performa pratinjau live** (penting, karena render server ± 200–600 ms/halaman):
- Debounce 500 ms di composer; pertahankan gambar terakhir selama request berjalan.
- `AbortController` untuk membatalkan render yang sudah usang.
- Cache hasil preview di memori per instance dengan key `sha1(template|content|tag|topic)`, TTL 10 menit.
- Batasi preview composer ke halaman pertama saja (halaman lain tetap dirender saat publish).

---

## 8. Perubahan frontend

### 8.1 Pratinjau (preview) — tetap ada, mekanismenya tidak berubah

Pratinjau composer **sudah** berasal dari backend hari ini, bukan dari CSS frontend:

```
PublishModal.vue:259  api.previewFessCanvas()
  → POST /api/fesses/canvas/preview
  → CanvasService.renderPreviewImages()  (resvg, PNG asli)
  → { images: ["data:image/png;base64,…"], page_count }
  → PostPreviewCarousel.vue:39  <img class="post-carousel__card-image">
```

PNG yang tampil di pratinjau adalah gambar yang sama yang diposting ke Instagram
(komentar kode: *"identik dengan PNG yang diposting"*). Rencana ini **mempertahankan
endpoint dan output yang sama persis**; yang berubah hanya sumber metadata template
(dari `config/templates.js` → `GET /api/templates`).

**Keputusan (disetujui): hapus jalur cadangan DOM.**

Saat ini `PostPreview.vue` adalah replika kartu berbasis DOM/CSS yang hanya muncul bila
request render gagal (`previewError` → *"Pratinjau ringan ditampilkan sebagai cadangan"*).
Jalur itu dihapus karena kartu cadangan *mirip tapi tidak identik* dengan hasil posting —
berisiko membuat user salah menilai hasil akhir. Penggantinya: `AppStateView variant="error"`
+ tombol "Coba lagi".

Verifikasi keterpakuan (tidak ada konsumen lain):
- `PostPreviewCarousel.vue` hanya di-import `PublishModal.vue`.
- `PostPreview.vue` hanya di-import `PostPreviewCarousel.vue`.
- `cardPagination.js` hanya dipakai kedua file di atas.

Konsekuensi: `PostPreview.vue` (±841 baris), `PostPreviewCarousel.vue` disederhanakan,
dan `cardPagination.js` (±400 baris, "cermin dari layoutText/paginate backend") **dihapus**.
Jumlah halaman carousel kini dibaca dari `page_count` respons backend, bukan dihitung ulang
di browser. Ini menghilangkan duplikasi logika paginasi terbesar di repo.

| File | Aksi |
| --- | --- |
| `src/config/templates.js` (± 1.200 baris) | **hapus** |
| `src/utils/cardPagination.js` (± 400 baris) | **hapus** |
| `src/components/compose/PostPreview.vue` (841 baris) | **hapus** |
| `src/components/compose/PostPreviewCarousel.vue` | sederhanakan: hanya slide `card-image` + media; error state bila `previewImages` kosong |
| `src/stores/templatesStore.js` | **baru** — fetch `/templates` sekali, cache di Pinia |
| `src/composables/useTemplates.js` | **baru** — akses store + fallback loading/error |
| `src/components/compose/TemplateModal.vue` | thumbnail CSS → `<img :src="t.thumbnailUrl">` |
| `src/components/compose/PublishModal.vue` | hapus teks "pratinjau ringan sebagai cadangan"; ganti ke error + retry |
| `src/views/CreateFessPage.vue` | `pickRandomTemplateKey` → pilih acak dari store |

Temuan tambahan (terverifikasi): `html-to-image` **tidak pernah di-import** — hanya disebut di
komentar `PostPreview.vue`/`PostPreviewCarousel.vue` dan masih tercantum di `package.json`.
Rasterisasi kartu di browser sudah tidak ada, jadi setelah `PostPreview.vue` dihapus,
dependency ini bisa dibuang (`vite.config.js` juga punya `manualChunks` khusus
`export-vendor` untuk paket tersebut yang ikut jadi usang).

Yang **tetap** di frontend: `videoNormalizer.js` (ffmpeg.wasm) dan `MediaUploader.vue`
(rasterisasi canvas 2D untuk kompresi media user) — keduanya tidak terkait template.

---

## 9. Fase implementasi

**Fase 0 — hygiene repo (tanpa perubahan perilaku)** — ✅ selesai
- Pindahkan `template-card/*.svg` → `backend/assets/templates/` (masuk git, ikut
  `includeFiles` `assets/**` di `backend/vercel.json`).
- `backend/docs/` dokumen ini.

**Fase 1 — model & import** — ✅ selesai
- `Template` di `schema.prisma` + migration `20261028000000_template_model`
  (SQL ditulis tangan lalu `migrate deploy`; `migrate dev` butuh shadow DB).
- `scripts/import-templates.mjs` — normalisasi + ukur + label/palette/checksum + upsert
  idempotent per `key`. Script npm: `template:measure`, `template:verify`, `template:import:dev`.
- `prisma/seed.ts` **tidak** disentuh: file itu terhapus di working tree (status `D`) dan
  bukan bagian fitur ini. Import template memakai script tersendiri.
- Verifikasi: 12 baris `Template` aktif, run kedua melaporkan "tidak berubah".

**Fase 2 — renderer** — ✅ selesai
- Renderer di `CanvasService` (lihat §6), frame kutipan di `buildSvgQuoteFrame` (§6.2).
- `tests/template-renderer.test.ts` — 12 test memakai SVG asli + `docs/template-geometry.json`:
  1 baris → 1 halaman, 30 baris → 5 halaman, 200 baris → 10 halaman + `…`, kutipan ber-frame,
  footer/branding (host frontend), handle+tanggal, thumbnail deterministik, dan seluruh
  12 template.
- Render visual 12 template + halaman 2 diverifikasi manual sebelum artefak dibersihkan
  (`npm run template:verify` bisa membuatnya lagi).

**Fase 3 — API** — ✅ selesai
- `routes/template.routes.ts` + `controllers/template.controller.ts` + daftar di `routes/index.ts`.
- Preview endpoint memakai template DB (fallback legacy bila DB gagal).
- Thumbnail katalog ada di Fase 4b (selesai).

**Fase 4 — frontend** — ✅ selesai
- `stores/templateStore.js`: katalog dari `GET /api/templates`, cache 5 menit, panggilan
  bersamaan berbagi satu promise, getter `label`/`aspectRatio`/`randomKey`.
- `TemplateModal.vue` memakai katalog API (loading, error + "Coba lagi", thumbnail palette
  dari `palette` DB) — tidak ada lagi salinan template di frontend.
- `PostPreviewCarousel.vue` hanya menampilkan `<img>` PNG hasil render backend; `PublishModal`
  menampilkan state error + tombol "Coba lagi" bila render gagal.
- Dihapus: `components/compose/PostPreview.vue`, `utils/cardPagination.js`, `config/templates.js`
  (total ±2.300 baris duplikasi hilang).
- `CreateFessPage.vue`: template acak diambil dari store setelah katalog dimuat; draf yang
  sudah ada tetap dihormati.
- Verifikasi: `npm run build` lolos; `getTemplates` lewat proxy Vite mengembalikan 12 item;
  preview HTTP menghasilkan PNG untuk template 01/04/06 (termasuk versi multi-halaman +
  kutipan), dicek visual.
- Catatan: `npm run format:check` repo masih gagal karena 54 file lama; hanya file yang
  disentuh fitur ini yang diformat.

**Fase 4b — thumbnail katalog** — ✅ selesai
- `scripts/template-thumbnails.ts` merender halaman 1 lewat `CanvasService.renderTemplateThumbnail`
  (contoh deterministik, `withQuote`, host footer bisa dioverride) lalu mengunggah PNG lewat
  `StorageService.uploadBuffer`. Tidak ada geometri baru: sumbernya `measureTemplate()` yang sama
  dengan import DB.
- Path deterministik `templates/<key>-v<version>.png` (upsert), PNG 540×675 (±40–75 KB/template,
  total ±700 KB). `version` dibaca dari DB; `--no-db` memakai v1 untuk unggah sebelum import.
  Setelah import yang menaikkan `version` (checksum SVG berubah), jalankan ulang script agar
  path `v<n>` baru dan `thumbnailUrl` ikut diperbarui.
- Opsi: `--env dev|prod`, `--only`, `--host`, `--width`, `--out`, `--no-db`, `--dry-run`,
  `--no-quote`, dan `--confirm-prod` (guard tulis DB produksi).
- Sudah diunggah ke bucket dev (`confess-media-dev`) dan produksi (`confess-media`); 12 baris
  dev sudah terisi `thumbnailUrl`. Baris produksi diisi saat go-live (§12.1).

**Fase 5 — admin (opsional)**
- CRUD template di konsol Super Admin + upload SVG baru (dengan validator yang sama
  seperti import script).

**Fase 6 — pensiun legacy**
- Setelah tidak ada fess aktif berkey lama: hapus cabang `if (template.key === …)`,
  `LEGACY_TEMPLATE_KEYS`, dan `constants/templates.ts` (sisakan `ASPECTS`).

---

## 10. Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| resvg ≠ browser untuk `mix-blend-mode`/`letter-spacing` | kartu sedikit berbeda dari desain | golden test + cek visual; drop blend mode bila perlu |
| Area isi hanya 4 baris | fess panjang jadi banyak halaman | paginasi per halaman + indikator `i/n`; batas 10 halaman (batas carousel IG) |
| Kutipan tidak punya slot di 12 desain | kutipan tak bisa ditampilkan / menabrak teks | frame digambar renderer via `slots.quote`; `firstCap < restCap`; test visual 12 template |
| Preview server terasa lambat | UX composer menurun | debounce, abort, cache hash, render halaman 1 saja |
| Preview gagal total (backend down) | composer tak bisa menampilkan kartu | state error + retry eksplisit; tidak ada lagi kartu DOM palsu (keputusan disetujui) |
| `svgSource` 50 KB × 12 di DB | query berat | `select` eksplisit (jangan ambil `svgSource` untuk listing), cache in-memory |
| Fess lama berkey lama | kartu rusak | fallback legacy tetap hidup sampai Fase 6 |
| `template-card/` di luar git | aset hilang / tidak ter-deploy | dipindahkan di Fase 0 sebelum kerja lain |
| Zod enum statis | posting template baru ditolak | ganti ke validasi async di service |

---

## 11. Checklist verifikasi

- [x] `npx vitest run tests/template-renderer.test.ts` hijau (12 test, 12 template).
- [x] `npx vitest run` penuh hijau (31 file / 354 test, tidak ada regresi
      `canvas.service.test.ts`, `canvas.preview.test.ts`, `validators.test.ts`).
- [x] `npx tsc -p tsconfig.build.json --noEmit` lolos (TS strict, import `.js`).
- [x] `GET /api/templates` mengembalikan 12 item aktif tanpa `svgSource`/`slots`.
- [x] Pratinjau composer = PNG hasil render backend (dicek via HTTP untuk 01/04/06; 9 lain
      memakai jalur render yang sama dan sudah diverifikasi di Fase 2).
- [x] Pratinjau multi-halaman: `images.length` preview = `page_count` backend (6/5/3 halaman
      pada uji 01/04/06).
- [x] Paginasi: konten pendek → 1 halaman; ~30 baris → multi-halaman;
      sangat panjang → tepat 10 halaman + `…` (test per template).
- [ ] Carousel: kartu + media tergabung, total ≤ 10 slide, `carouselOrder` dihormati.
- [x] Kutipan: `quoted_fess` → frame di halaman 1, tidak menembus batas template, teks fess
      tidak tumpang tindih (diverifikasi visual untuk 12 template).
- [x] `npx vitest run tests/template-renderer.test.ts` mencakup kutipan panjang & pemotongan `…`.
- [x] Preview gagal → state error + "Coba lagi" (tanpa kartu DOM).
- [x] `grep -r "cardPagination\|config/templates" frontend/src` → kosong.
- [x] Thumbnail katalog: 12 PNG `templates/<key>-v1.png` di bucket dev & produksi
      (540×675, total ±700 KB); `thumbnail_url` 12 baris dev HTTP 200. DB produksi diisi
      saat go-live (§12.1).
- [x] Fess lama (key `cyberpunk`, `default`, …) masih ter-render (fallback legacy).
- [ ] Posting ke Instagram dev berhasil untuk minimal 1 template baru (gambar + carousel).
- [ ] `npm run format:check` frontend bersih (54 file lama di luar fitur ini masih gagal).
- [x] Tidak ada `template-card/` yang dirujuk saat runtime.

---

## 12. Lingkungan & deploy (ringkas)

- Kerja lokal: **selalu** `backend/.env.development` (script `prisma:*:dev`).
  Jangan pernah mengubah file `.env*` tanpa persetujuan eksplisit.
- Dev: backend `be-fnc-dev.vercel.app`, frontend `fessncurious-dev.vercel.app`
  (boleh `vercel --prod` ke project dev).
- Production: `be-fnc.vercel.app` & `fessncurious.vercel.app`, auto-deploy dari branch `main`
  di GitHub. **Jangan push ke `main` dan jangan deploy manual ke project production.**
- `main` = produksi. Kerjakan fitur di branch terpisah; jangan commit/push langsung ke `main`.

### 12.1 Go-live produksi (belum dijalankan)

Status 28 Okt 2026: `npx prisma migrate status` (membaca `backend/.env`) menunjukkan 15 migrasi
sudah applied dan **hanya** `20261028000000_template_model` yang pending. Artinya
`npx prisma migrate deploy` hanya membuat tabel `Template` (additive: 1 tabel + 2 index, tanpa FK)
dan tidak mengeksekusi backlog CTF. Tetap jalankan `migrate status` tepat sebelum deploy.

Kode aman di-deploy lebih dulu: `buildPages()` menangkap kegagalan baca `Template` dan jatuh ke
renderer lama, jadi situs tidak rusak — tetapi 12 template baru **belum muncul** (katalog 500 →
composer memakai `default` legacy) sampai database produksi diisi.

Urutan yang disarankan (butuh persetujuan eksplisit karena menulis DB produksi):

1. Backup database produksi (snapshot Supabase) sebelum menyentuh apa pun.
2. Pastikan hanya migrasi template yang pending: `npx prisma migrate status`.
   Apply: `npx prisma migrate deploy`.
   - Fallback bila `migrate deploy` tidak bisa dipakai: jalankan
     `prisma/manual/20261028000000_template_model.sql` lewat psql/Supabase SQL Editor
     (idempoten, aman diulang), lalu
     `npx prisma migrate resolve --applied 20261028000000_template_model`.
   - Jangan menyalin file manual itu ke `prisma/migrations/`: checksum-nya berbeda dan Prisma
     akan menganggapnya migrasi baru.
3. Isi 12 template: `npm run template:import` (membaca `backend/.env` → DB produksi).
   Verifikasi: `SELECT count(*) FROM "Template" WHERE status = 'active';` → 12, dan
   `GET https://be-fnc.vercel.app/api/templates` → 12 item (thumbnail masih `null`).
4. Isi thumbnail:
   `npm run template:thumbnails:prod -- --host fessncurious.vercel.app --confirm-prod`.
   Script merender halaman 1 dari SVG yang sama, mengunggah
   `templates/<key>-v<n>.png` ke bucket `confess-media`, lalu menulis `Template.thumbnailUrl`.
   - PNG-nya sudah diunggah lebih dulu (28 Okt 2026) dengan `--no-db`; langkah ini hanya
     menautkan URL (upsert, file tidak terduplikasi).
   - Verifikasi: semua `thumbnail_url` dari API merespons HTTP 200.
5. Merge `feat/svg-templates-db` ke `main` (kedua repo) → auto-deploy produksi.
6. Canary: buka composer produksi, pastikan pemilih berisi 12 template (dengan gambar
   thumbnail), pratinjau PNG tampil, dan satu posting uji menghasilkan kartu yang benar
   (termasuk footer host `fessncurious.vercel.app`).
7. Pantau log `[Canvas] Gagal membaca template dari DB` — kalau muncul, berarti tabel/isi belum
   siap dan semua render masih jatuh ke template legacy.
