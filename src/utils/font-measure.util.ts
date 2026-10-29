/**
 * Pengukuran & pemotongan teks memakai font yang di-bundle di `fonts/`.
 *
 * Dipakai renderer thumbnail (lebar pill footer, auto-fit judul) dan renderer
 * watermark foto Instagram. Diukur dengan `opentype.js` karena resvg memakai
 * file font yang sama, sehingga lebar hasil ukur mendekati lebar glyph asli
 * (selisih ±3%, sebab itu pemanggil menyisakan margin aman).
 */
import opentype from 'opentype.js';
import fs from 'fs';
import { getFontFileFor } from '../config/fonts.js';

export type MeasureFamily = 'sans' | 'mono';

const fontCache = new Map<string, opentype.Font | null>();

/** Lebar teks memakai font bundled; fallback rasio bila font tidak tersedia. */
export function measureFontWidth(
  family: MeasureFamily,
  weight: number,
  text: string,
  fontSize: number
): number {
  const key = `${family}:${weight}`;
  if (!fontCache.has(key)) {
    const file = getFontFileFor(family, weight);
    let font: opentype.Font | null = null;
    if (file) {
      try {
        font = opentype.parse(fs.readFileSync(file) as unknown as ArrayBuffer);
      } catch {
        font = null;
      }
    }
    fontCache.set(key, font);
  }
  const font = fontCache.get(key);
  const ratio = family === 'mono' ? 0.6 : 0.56;
  if (!font) return text.length * fontSize * ratio;
  try {
    return font.getAdvanceWidth(text, fontSize, { kerning: true });
  } catch {
    return text.length * fontSize * ratio;
  }
}

/** Potong teks dengan elipsis sampai muat di lebar tertentu. */
export function fitTextToWidth(
  text: string,
  fontSize: number,
  maxWidth: number,
  measure: (text: string, size: number) => number
): string {
  const limit = Math.max(0, maxWidth);
  if (measure(text, fontSize) <= limit) return text;
  let value = text;
  while (value.length > 1 && measure(`${value}…`, fontSize) > limit) {
    value = value.slice(0, -1).trimEnd();
  }
  return `${value}…`;
}