/**
 * Render SVG → PNG memakai font yang di-bundle di `fonts/`.
 *
 * Penting: `sharp().composite(svg)` merender teks dengan font sistem, sehingga
 * di Vercel (Linux tanpa Poppins) hasilnya berbeda dari lokal. resvg dengan
 * daftar font yang sama dengan kartu menjaga tipografi konsisten di mana pun.
 */
import { Resvg } from '@resvg/resvg-js';
import { getFontFiles } from '../config/fonts.js';

export function renderSvgToPng(svg: string, defaultFamily = 'Poppins'): Buffer {
  const fontFiles = getFontFiles();
  const resvg = new Resvg(svg, {
    font: fontFiles.length
      ? { fontFiles, loadSystemFonts: false, defaultFontFamily: defaultFamily }
      : { defaultFontFamily: defaultFamily },
  });
  return Buffer.from(resvg.render().asPng());
}