/**
 * Aset emoji Twemoji (inline SVG) untuk renderer canvas.
 *
 * `assets/emoji-paths.json` dihasilkan oleh scripts/gen-emoji-assets.mjs dari
 * paket dev `@twemoji/svg`, berisi markup SVG (viewBox 0 0 36 36) per sekuens
 * emoji, mis. { "1f62d": "<path .../>", "2764-fe0f": ... }.
 *
 * Twemoji © Twitter/X — lisensi CC-BY 4.0 (https://github.com/jdecked/twemoji).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cached: Record<string, string> | null = null;

function loadMap(): Record<string, string> {
  if (cached) return cached;
  const candidates = [
    path.resolve(__dirname, '../../assets/emoji-paths.json'),
    path.resolve(process.cwd(), 'assets/emoji-paths.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        cached = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, string>;
        return cached;
      }
    } catch {
      /* lanjut ke kandidat berikutnya */
    }
  }
  console.warn(
    '[emoji] assets/emoji-paths.json tidak ditemukan — emoji dirender oleh font emoji (mono) alih-alih Twemoji berwarna.'
  );
  cached = {};
  return cached;
}

/**
 * Cari markup SVG Twemoji untuk sebuah sekuens emoji (mis. "❤️", "🇮🇩", "👍🏽").
 * Beberapa varian kunci dicoba karena Twemoji kadang menamai file tanpa
 * variation selector (mis. "2764.svg" untuk ❤️).
 */
export function getEmojiSvgMarkup(sequence: string): string | null {
  const map = loadMap();
  const cps = [...sequence].map((c) => c.codePointAt(0)!);
  const key = (arr: number[]) => arr.map((c) => c.toString(16)).join('-');

  const variants: number[][] = [cps];
  variants.push(cps.filter((c) => c !== 0xfe0f));
  if (cps.length === 1 && cps[0] <= 0xffff) variants.push([cps[0], 0xfe0f]);
  const zwjIdx = cps.indexOf(0x200d);
  if (zwjIdx > 0) variants.push(cps.slice(0, zwjIdx));
  if (cps.length > 1) variants.push([cps[0]]);

  for (const variant of variants) {
    const hit = map[key(variant)];
    if (hit) return hit;
  }
  return null;
}
