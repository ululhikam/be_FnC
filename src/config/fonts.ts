/**
 * Font & aset renderer canvas.
 *
 * Renderer PNG canvas memakai @resvg/resvg-js dengan daftar font yang ikut
 * ter-bundle di folder `fonts/` (di-include ke deployment lewat vercel.json →
 * includeFiles) supaya hasil render identik di lokal (Windows) dan Vercel
 * (Linux tanpa font sistem).
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
 * Daftar file font untuk resvg (Poppins + Noto Sans + Noto Emoji sebagai
 * fallback glyph yang tidak ada di Poppins / emoji yang tidak punya aset
 * Twemoji). Dikembalikan [] jika folder fonts/ tidak ada — pemanggil boleh
 * jatuh ke font sistem.
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
    .filter((f) => /^(Poppins|NotoSans|NotoEmoji)[\w-]*\.(ttf|otf)$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f));
  return cachedFontFiles;
}

const POPPINS_FILES: Record<number, string> = {
  400: 'Poppins-Regular.ttf',
  500: 'Poppins-Medium.ttf',
  600: 'Poppins-SemiBold.ttf',
  700: 'Poppins-Bold.ttf',
  800: 'Poppins-ExtraBold.ttf',
  900: 'Poppins-Black.ttf',
};

/** Path file Poppins per weight (untuk pengukuran teks via opentype.js). */
export function getPoppinsFontFile(weight: number): string | null {
  const dir = getFontsDir();
  if (!dir) return null;
  const candidate = path.join(dir, POPPINS_FILES[weight] || POPPINS_FILES[600]);
  if (fs.existsSync(candidate)) return candidate;
  const fallback = path.join(dir, POPPINS_FILES[600]);
  return fs.existsSync(fallback) ? fallback : null;
}
