import { describe, it, expect } from 'vitest';
import {
  normalizeTitleCase,
  parseJsonObject,
  sanitizeTitle,
  scrubPromptInput,
} from '../src/services/ai/sanitize.js';

describe('scrubPromptInput', () => {
  it('membuang URL, email, nomor telepon, dan mention sebelum dikirim ke provider', () => {
    const text = scrubPromptInput(
      'Cek https://rahasia.test/a?b=1 atau email ani@kampus.ac.id, wa 081234567890, tag @admin #viral'
    );
    expect(text).not.toContain('http');
    expect(text).not.toContain('kampus.ac.id');
    expect(text).not.toContain('081234567890');
    expect(text).not.toContain('@admin');
    expect(text).not.toContain('#viral');
    expect(text).toContain('Cek');
  });

  it('memotong di batas kata, bukan di tengah kata', () => {
    const text = scrubPromptInput('kata '.repeat(60), 30);
    expect(text.length).toBeLessThanOrEqual(30);
    expect(text.endsWith('kata')).toBe(true);
  });

  it('menormalkan baris baru berlebih dan karakter zero-width', () => {
    const text = scrubPromptInput('Halo\u200b\n\n\n\ndunia');
    expect(text).toBe('Halo\n\ndunia');
  });
});

describe('parseJsonObject', () => {
  it('menerima JSON polos', () => {
    expect(parseJsonObject('{"title":"Judul"}')).toEqual({ title: 'Judul' });
  });

  it('menerima JSON di dalam pagar kode', () => {
    expect(parseJsonObject('```json\n{"title":"Judul"}\n```')).toEqual({ title: 'Judul' });
  });

  it('menerima objek yang diapit teks pengantar', () => {
    expect(parseJsonObject('Tentu! {"title":"Judul"} semoga membantu')).toEqual({ title: 'Judul' });
  });

  it('mengembalikan null untuk jawaban yang bukan objek JSON', () => {
    expect(parseJsonObject('Judul biasa saja')).toBeNull();
    expect(parseJsonObject('[1,2,3]')).toBeNull();
    expect(parseJsonObject('')).toBeNull();
  });
});

describe('normalizeTitleCase', () => {
  it('mengubah judul HURUF BESAR semua menjadi Title Case', () => {
    expect(normalizeTitleCase('KANTIN TUTUP LEBIH AWAL')).toBe('Kantin Tutup Lebih Awal');
  });

  it('membesarkan huruf pertama judul yang diawali huruf kecil', () => {
    expect(normalizeTitleCase('kantin tutup lebih awal')).toBe('Kantin tutup lebih awal');
  });

  it('tidak mengubah judul yang sudah wajar', () => {
    expect(normalizeTitleCase('Kantin Tutup Lebih Awal')).toBe('Kantin Tutup Lebih Awal');
  });
});

describe('sanitizeTitle', () => {
  it('menerima judul 3–5 kata yang wajar', () => {
    expect(sanitizeTitle('Kantin Tutup Lebih Awal')).toBe('Kantin Tutup Lebih Awal');
  });

  it('membuang emoji tanpa menyisakan spasi ganda', () => {
    expect(sanitizeTitle('Kantin tutup 😭 lebih awal')).toBe('Kantin tutup lebih awal');
  });

  it('membuang tanda kutip pembungkus dan tanda baca akhir', () => {
    expect(sanitizeTitle('"Kantin tutup lebih awal!"')).toBe('Kantin tutup lebih awal');
  });

  it('menolak judul yang mengandung kata terlarang base', () => {
    expect(sanitizeTitle('Kantin tutup lebih awal', { bannedWords: ['kantin'] })).toBeNull();
  });

  it('menolak kata klikbait internal', () => {
    expect(sanitizeTitle('Bocoran kantin tutup awal')).toBeNull();
    expect(sanitizeTitle('Cerita viral kantin kampus')).toBeNull();
  });

  it('menolak judul terlalu pendek atau jumlah kata di luar 3–5', () => {
    expect(sanitizeTitle('Kantin tutup')).toBeNull();
    expect(sanitizeTitle('Kantin tutup lebih awal karena listrik mati')).toBeNull();
    expect(sanitizeTitle('A b c')).toBeNull();
    expect(sanitizeTitle('   ')).toBeNull();
  });

  it('menolak judul yang isinya hanya PII setelah disaring', () => {
    expect(sanitizeTitle('081234567890 ani@kampus.ac.id https://x.test')).toBeNull();
  });

  it('menolak judul yang bertele-tele (lebih dari 5 kata)', () => {
    expect(sanitizeTitle('Kantin kampus tutup lebih awal dari jadwal biasa')).toBeNull();
  });

  it('membatasi panjang mengikuti opsi maxChars di batas kata', () => {
    expect(sanitizeTitle('Kantin kampus tutup lebih awal', { maxChars: 20 })).toBe(
      'Kantin kampus tutup'
    );
  });
});