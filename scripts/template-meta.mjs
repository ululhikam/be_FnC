/**
 * Metadata tampilan + palette template kartu.
 *
 * Dipakai bersama oleh `import-templates.mjs` (isi DB) dan
 * `template-thumbnails.ts` (render thumbnail), supaya label/deskripsi/warna
 * pemilih template hanya punya satu sumber. Geometri tetap milik
 * `measure-templates.mjs`; file ini tidak menyimpan angka desain.
 */
import { stripDefs } from './measure-templates.mjs';

/**
 * Label & deskripsi hanya untuk UI pemilih template. Default-nya diturunkan dari
 * nama file; entri di sini menimpa bila penulisan otomatis terbaca janggal
 * (mis. akronim seperti OMR/ID yang harus kapital).
 */
export const DISPLAY = {
  '01-helpdesk-ticket': { label: 'Helpdesk Ticket', description: 'Tiket layanan kampus dengan panel pesan besar.', category: 'classic' },
  '02-network-map': { label: 'Network Map', description: 'Peta jaringan kampus dengan balon pesan.', category: 'classic' },
  '03-exam-omr': { label: 'Exam OMR', description: 'Lembar jawaban OMR dengan pesan di kolom kanan.', category: 'campus' },
  '04-sticky-note': { label: 'Sticky Note', description: 'Catatan tempel miring dengan pita perekat.', category: 'playful' },
  '05-campus-catalog': { label: 'Campus Catalog', description: 'Kartu katalog perpustakaan dengan cap OPEN.', category: 'classic' },
  '06-noticeboard': { label: 'Noticeboard', description: 'Papan pengumuman kampus dengan paku kayu.', category: 'classic' },
  '07-student-id': { label: 'Student ID', description: 'Kartu identitas mahasiswa dengan pita nama.', category: 'campus' },
  '08-services-file': { label: 'Services File', description: 'Berkas layanan mahasiswa dengan klip kertas.', category: 'campus' },
  '09-campus-daily': { label: 'Campus Daily', description: 'Koran kampus dengan kolom headline.', category: 'editorial' },
  '10-campus-transit': { label: 'Campus Transit', description: 'Tiket bus kampus dengan kode halte.', category: 'campus' },
  '11-cassette-mixtape': { label: 'Cassette Mixtape', description: 'Kaset mixtape dengan label tulisan tangan.', category: 'playful' },
  '12-lab-report': { label: 'Lab Report', description: 'Laporan laboratorium dengan jam pasir.', category: 'editorial' },
};

export const titleCase = (key) =>
  key
    .replace(/^\d+-/, '')
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

const luminance = (hex) => {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * Warna dominan untuk UI pemilih template. Dihitung dari atribut `fill`
 * (bukan hardcoded), supaya template baru otomatis dapat warna yang benar.
 */
export function derivePalette(svg) {
  const counts = new Map();
  for (const m of stripDefs(svg).matchAll(/fill="#([0-9a-fA-F]{6})"/g)) {
    const hex = `#${m[1].toUpperCase()}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  const light = ordered.filter((hex) => luminance(hex) > 0.78);
  const dark = ordered.filter((hex) => luminance(hex) < 0.35);
  const accent = ordered.find(
    (hex) => luminance(hex) > 0.2 && luminance(hex) < 0.78 && !light.includes(hex)
  );
  return {
    bg: light[0] ?? '#FFFFFF',
    ink: dark[0] ?? '#111111',
    accent: accent ?? dark[0] ?? '#111111',
  };
}
