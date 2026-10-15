# Fess n Curious Backend API

Backend REST API untuk platform confession anonim berbasis Base (**Fess n Curious / FessHub**).
Dibangun mengikuti spesifikasi lengkap OpenAPI 3.1 dari `api-contract.yml`.

---

## 🚀 Tech Stack

- **Framework**: Express.js with TypeScript (`NodeNext`)
- **Database & ORM**: PostgreSQL (Supabase Database) via Prisma ORM 6
- **Object Storage**: Supabase Storage (untuk upload media, foto profil avatar, dan canvas story export)
- **Autentikasi & Otorisasi**:
  - Passport.js (`passport-jwt`, `passport-google-oauth20`, `passport-instagram`)
  - Google OAuth 2.0 (Google ID Token verification & OAuth flow)
  - Meta for Developers Instagram App (Instagram Graph API OAuth & verifikasi akun)
- **Validasi**: Zod dengan response error schema standar OpenAPI
- **Testing**: Vitest + Supertest untuk unit & integration testing
- **Arsitektur**: Clean Layered Architecture (Controllers, Services, Middlewares, Validators, Utils, Routes)

---

## 📂 Struktur Proyek

```
backend/
├── prisma/
│   ├── schema.prisma       # Prisma schema (PostgreSQL / Supabase)
│   └── seed.ts             # Database seeder (admin, bases, fesses, topics, songs)
├── src/
│   ├── config/
│   │   ├── env.ts          # Typed environment variables
│   │   ├── prisma.ts       # PrismaClient singleton dengan query logger
│   │   ├── supabase.ts     # Supabase client untuk Object Storage
│   │   └── passport.ts     # Konfigurasi Passport (JWT, Google, Instagram)
│   ├── constants/
│   │   ├── topics.ts       # 68 topik confession lintas kategori
│   │   ├── songs.ts        # Lampiran musik untuk confession
│   │   └── templates.ts    # 8 template canvas & 3 rasio aspek media sosial
│   ├── controllers/        # Request handlers
│   ├── middlewares/
│   │   ├── auth.middleware.ts     # requireAuth, optionalAuth, requireRole
│   │   ├── validate.middleware.ts # Zod validator (body, query, params)
│   │   ├── upload.middleware.ts   # Multer memory storage (50MB limit)
│   │   ├── rateLimit.middleware.ts# Rate limiter per IP
│   │   └── error.middleware.ts    # Global error & 404 handler
│   ├── routes/             # Modular Express routers
│   ├── services/           # Business logic & query optimization
│   ├── utils/              # JWT, bcrypt, response formatter, helpers
│   ├── app.ts              # Express application configuration
│   └── server.ts           # Server bootstrap & graceful shutdown
├── tests/                  # 12 test suites (72 unit & integration tests)
├── .env.example
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## ⚙️ Variabel Lingkungan (`.env`)

Salin file `.env.example` ke `.env`:

```env
PORT=3000
NODE_ENV=development
API_PREFIX=/api
FRONTEND_URL=http://localhost:5173

# JWT
JWT_SECRET=fess_super_secret_jwt_key_replace_with_strong_secret_in_prod_2026
JWT_EXPIRES_IN=7d

# Supabase PostgreSQL (Prisma)
DATABASE_URL=postgresql://postgres.yourproject:yourpassword@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.yourproject:yourpassword@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres

# Supabase Storage
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-supabase-service-role-or-anon-key
SUPABASE_BUCKET=confess-media

# Google OAuth 2.0
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback

# Meta for Developers / Instagram Graph API
INSTAGRAM_CLIENT_ID=your-meta-instagram-app-id
INSTAGRAM_CLIENT_SECRET=your-meta-instagram-app-secret
INSTAGRAM_CALLBACK_URL=http://localhost:3000/api/auth/instagram/callback
INSTAGRAM_REDIRECT_URI=http://localhost:3000/api/auth/instagram/callback
```

---

## 🛠️ Cara Menjalankan

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Generate Prisma Client
```bash
npm run prisma:generate
```

### 3. Push Schema ke Database Supabase
```bash
npm run prisma:push
```

### 4. Seed Data Awal
```bash
npm run prisma:seed
```

### 5. Jalankan Server Development
```bash
npm run dev
```

Server akan aktif di `http://localhost:3000` dengan endpoint API di `http://localhost:3000/api`.

---

## 🧪 Menjalankan Unit & Integration Tests

Semua fungsi bisnis, validasi, orm query optimization, dan controller telah dilengkapi unit test:

```bash
npm test
```

Hasil test: **12 test suites, 72 tests passed**.

---

## 📸 Integrasi Instagram via Meta for Developers

Sistem ini mendukung integrasi Instagram Graph API melalui Meta for Developers App:
1. **Verifikasi Akun**: Endpoint `POST /api/auth/instagram/verify` memverifikasi token atau username Instagram via Graph API (`https://graph.instagram.com/me`).
2. **Passport Instagram OAuth**: Endpoint `GET /api/auth/instagram` dan `GET /api/auth/instagram/callback` memungkinkan pengguna menautkan akun Instagram secara langsung.
3. **Auto-Post Canvas Story**: Endpoint `POST /api/admin/canvas/export` merender confession menjadi kartu visual berukuran 9:16 (Instagram Story) atau 4:5 / 1:1 (Feed) dan memicu publikasi via Graph API.
