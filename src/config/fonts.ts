/**
 * Bootstrap fontconfig untuk rendering SVG → PNG via sharp (librsvg/pango).
 *
 * Runtime Vercel (Linux) tidak punya font sistem — tanpa ini, semua teks pada
 * card canvas ter-render sebagai kotak tofu ([ ]). Modul ini mengarahkan
 * fontconfig ke font yang ikut ter-bundle di folder `fonts/` (di-include ke
 * deployment lewat vercel.json → includeFiles) dan harus di-import paling awal,
 * sebelum render pertama (lihat import pertama di src/app.ts).
 *
 * Efek samping lokal: karena fontconfig memakai daftar font ini juga di dev,
 * hasil render lokal identik dengan produksi.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function xmlEscape(p: string): string {
  return p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Cari folder fonts/ dari lokasi modul (dev/dist) atau cwd (Vercel: /var/task/fonts). */
function findFontsDir(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../fonts'),
    path.resolve(process.cwd(), 'fonts'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => /\.(ttf|otf)$/i.test(f))) {
        return dir;
      }
    } catch {
      /* lanjut ke kandidat berikutnya */
    }
  }
  return null;
}

function setupFonts(): void {
  try {
    if (process.env.FONTCONFIG_FILE) return; // sudah diatur manual — jangan timpa

    const fontsDir = findFontsDir();
    if (!fontsDir) {
      console.warn(
        '[fonts] Folder fonts/ tidak ditemukan — teks SVG bisa tampil sebagai kotak pada runtime tanpa font sistem.'
      );
      return;
    }

    const cacheDir = path.join(os.tmpdir(), 'fess-fontconfig-cache');
    fs.mkdirSync(cacheDir, { recursive: true });

    const confPath = path.join(os.tmpdir(), 'fess-fonts.conf');
    const dir = xmlEscape(fontsDir.replace(/\\/g, '/'));
    const cache = xmlEscape(cacheDir.replace(/\\/g, '/'));
    const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${dir}</dir>
  <cachedir>${cache}</cachedir>
  <alias>
    <family>sans-serif</family>
    <prefer><family>Noto Sans</family></prefer>
  </alias>
  <alias>
    <family>serif</family>
    <prefer><family>Noto Sans</family></prefer>
  </alias>
  <alias>
    <family>Arial</family>
    <prefer><family>Noto Sans</family></prefer>
  </alias>
  <alias>
    <family>emoji</family>
    <prefer><family>Twemoji Mozilla</family></prefer>
    <acceptable><family>Noto Emoji</family></acceptable>
  </alias>
</fontconfig>
`;

    fs.writeFileSync(confPath, conf);
    process.env.FONTCONFIG_FILE = confPath;
    console.log(`[fonts] fontconfig diarahkan ke ${fontsDir}`);
  } catch (err: any) {
    console.warn('[fonts] Gagal menyiapkan fontconfig:', err?.message || err);
  }
}

setupFonts();
