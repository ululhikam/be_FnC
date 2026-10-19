/**
 * Font & aset renderer canvas.
 *
 * Renderer PNG canvas memakai @resvg/resvg-js dengan daftar font yang ikut
 * ter-bundle di folder `fonts/` (di-include ke deployment lewat vercel.json →
 * includeFiles) supaya hasil render identik di lokal (Windows) dan Vercel
 * (Linux tanpa font sistem).
 *
 * Empat keluarga font dipakai untuk variasi tipografi per template:
 *  - sans    → Poppins (modern, netral)
 *  - display → Bebas Neue (poster, uppercase, condensed)
 *  - serif   → DM Serif Display (editorial, klasik)
 *  - mono    → Fira Mono (terminal, teknis)
 *
 * Catatan: Twemoji.Mozilla.ttf (COLR) sengaja TIDAK dipakai — resvg tidak
 * merender font warna; emoji ditangani sebagai inline SVG Twemoji dari
 * `assets/emoji-paths.json` (lihat src/config/emoji.ts).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedFontsDir: string | null | undefined;

/** Cari folder fonts/ dari lokasi modul (dev/dist) atau cwd (Vercel: /var/task/fonts). */
export function getFontsDir(): string | null {
  if (cachedFontsDir !== undefined) return cachedFontsDir;
  const candidates = [
    path.resolve(__dirname, '../../fonts'),
    path.resolve(process.cwd(), 'fonts'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => /\.(ttf|otf)$/i.test(f))) {
        cachedFontsDir = dir;
        return dir;
      }
    } catch {
      /* lanjut ke kandidat berikutnya */
    }
  }
  cachedFontsDir = null;
  return null;
}

let cachedFontFiles: string[] | null = null;

/**
 * Daftar file font untuk resvg. Dikembalikan [] jika folder fonts/ tidak ada —
 * pemanggil boleh jatuh ke font sistem.
 */
export function getFontFiles(): string[] {
  if (cachedFontFiles) return cachedFontFiles;
  const dir = getFontsDir();
  if (!dir) {
    console.warn('[fonts] Folder fonts/ tidak ditemukan — render teks memakai font sistem.');
    cachedFontFiles = [];
    return cachedFontFiles;
  }
  cachedFontFiles = fs
    .readdirSync(dir)
    .filter((f) => /^(Poppins|NotoSans|NotoEmoji|BebasNeue|FiraMono|DMSerifDisplay)[\w-]*\.(ttf|otf)$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f));
  return cachedFontFiles;
}

/** Keluarga font yang tersedia untuk template. */
export type FontFamilyKey = 'sans' | 'display' | 'serif' | 'mono';

const POPPINS_FILES: Record<number, string> = {
  400: 'Poppins-Regular.ttf',
  500: 'Poppins-Medium.ttf',
  600: 'Poppins-SemiBold.ttf',
  700: 'Poppins-Bold.ttf',
  800: 'Poppins-ExtraBold.ttf',
  900: 'Poppins-Black.ttf',
};

const FAMILY_FILES: Record<FontFamilyKey, Record<number, string>> = {
  sans: POPPINS_FILES,
  display: { 400: 'BebasNeue-Regular.ttf' },
  serif: { 400: 'DMSerifDisplay-Regular.ttf' },
  mono: { 400: 'FiraMono-Regular.ttf', 700: 'FiraMono-Bold.ttf' },
};

const FAMILY_STACKS: Record<FontFamilyKey, string> = {
  sans: 'Poppins, Noto Sans, Arial, sans-serif',
  display: 'Bebas Neue, Poppins, Noto Sans, sans-serif',
  serif: 'DM Serif Display, Poppins, Noto Sans, serif',
  mono: 'Fira Mono, Poppins, Noto Sans, monospace',
};

/** CSS font-family stack untuk satu keluarga template. */
export function getFontCssStack(family: FontFamilyKey = 'sans'): string {
  return FAMILY_STACKS[family] || FAMILY_STACKS.sans;
}

/**
 * Path file font untuk kombinasi keluarga + weight (untuk pengukuran teks via
 * opentype.js). Keluarga display/serif hanya punya satu weight — weight lain
 * otomatis memakai file yang tersedia.
 */
export function getFontFileFor(family: FontFamilyKey, weight = 400): string | null {
  const dir = getFontsDir();
  if (!dir) return null;
  const files = FAMILY_FILES[family] || FAMILY_FILES.sans;
  const candidateName =
    files[weight] ||
    files[600] ||
    files[400] ||
    Object.values(files)[0];
  if (!candidateName) return null;
  const candidate = path.join(dir, candidateName);
  if (fs.existsSync(candidate)) return candidate;

  // Fallback terakhir: Poppins SemiBold (selalu ada di deployment).
  const fallback = path.join(dir, POPPINS_FILES[600]);
  return fs.existsSync(fallback) ? fallback : null;
}

/** Path file Poppins per weight (kompatibilitas pemanggil lama). */
export function getPoppinsFontFile(weight: number): string | null {
  return getFontFileFor('sans', weight);
}
