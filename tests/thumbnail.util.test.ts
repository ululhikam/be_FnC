import { describe, it, expect } from 'vitest';
import {
  FALLBACK_TITLE,
  allocateCarouselSlots,
  buildGradientStops,
  contrastRatio,
  darkenHex,
  dominantColor,
  fallbackTitle,
  fitTitle,
  isThumbnailModeAllowed,
  meanGammaLuminance,
  panelAlphaForLuminance,
  pickInkColor,
  quantizePalette,
  sanitizeTitleText,
  selectCoverMedia,
  watermarkLabel,
} from '../src/utils/thumbnail.util.js';

describe('thumbnail.util — pemilihan foto & slot', () => {
  it('memilih media gambar pertama dan melewati video/data URI', () => {
    expect(
      selectCoverMedia([
        { id: 'v1', type: 'video', url: 'https://cdn.test/a.mp4' },
        { type: 'image', url: 'data:image/png;base64,AAA' },
        { id: 'm2', type: 'image', url: 'https://cdn.test/foto.jpg' },
      ])
    ).toEqual({ id: 'm2', url: 'https://cdn.test/foto.jpg' });
  });

  it('mengembalikan null tanpa foto yang bisa dipakai', () => {
    expect(selectCoverMedia([{ type: 'video', url: 'https://cdn.test/a.mp4' }])).toBeNull();
    expect(selectCoverMedia(null)).toBeNull();
  });

  it('mengurangi kartu, bukan media user, saat thumbnail masuk', () => {
    // 4 media + 1 thumbnail → sisa 5 kartu dari 10.
    expect(
      allocateCarouselSlots({ cardCount: 8, mediaCount: 4, withThumbnail: true })
    ).toEqual({ maxCards: 5, droppedCards: 3, withThumbnail: true });

    // Tanpa thumbnail: 4 media → 6 kartu.
    expect(
      allocateCarouselSlots({ cardCount: 3, mediaCount: 4, withThumbnail: false })
    ).toEqual({ maxCards: 6, droppedCards: 0, withThumbnail: false });
  });

  it('menjaga total item tidak melebihi batas 10', () => {
    const plan = allocateCarouselSlots({ cardCount: 10, mediaCount: 10, withThumbnail: true });
    expect(plan.maxCards).toBe(0);
    expect(plan.maxCards + 10 + 1).toBeLessThanOrEqual(11);
  });
});

describe('thumbnail.util — warna', () => {
  it('mengkuantisasi piksel deterministik dan mengurutkan bobot', () => {
    const red = Buffer.from([220, 20, 20, 220, 20, 20, 10, 10, 10]);
    const palette = quantizePalette(red, 3);
    expect(palette[0].hex).toBe('#dc1414');
    expect(palette[0].weight).toBeCloseTo(2 / 3, 2);
    expect(dominantColor(red)).toBe('#dc1414');
  });

  it('menghitung kontras WCAG dan memilih ink yang terbaca', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(pickInkColor('#111111')).toBe('#ffffff');
    expect(pickInkColor('#f5f5f5')).toBe('#0b0d14');
  });

  it('membuat 3 stop gradien yang makin pekat ke bawah', () => {
    const stops = buildGradientStops('#3366cc');
    expect(stops).toHaveLength(3);
    expect(stops[0].alpha).toBeLessThan(stops[1].alpha);
    expect(stops[1].alpha).toBeLessThan(stops[2].alpha);
    expect(stops[0].alpha).toBeLessThan(0.2);
    expect(stops[2].alpha).toBeGreaterThan(0.9);
    expect(stops[2].color).toBe(darkenHex(darkenHex('#3366cc', 0.4), 0.25));
  });

  it('menghitung rata-rata luminance gamma untuk plat judul', () => {
    // Piksel hitam penuh → 0; putih penuh → 1; abu-abu tengah ≈ 0.5.
    expect(meanGammaLuminance(Buffer.from([0, 0, 0]))).toBe(0);
    expect(meanGammaLuminance(Buffer.from([255, 255, 255]))).toBeCloseTo(1, 3);
    expect(meanGammaLuminance(Buffer.from([128, 128, 128]))).toBeCloseTo(0.502, 2);
    expect(meanGammaLuminance(Buffer.alloc(0))).toBe(0);
    // Piksel alpha 0 dilewati pada buffer RGBA.
    expect(meanGammaLuminance(Buffer.from([255, 255, 255, 0, 0, 0, 0, 255]), 4)).toBe(0);
  });

  it('plat judul makin pekat pada foto terang dan dibatasi di kedua ujung', () => {
    expect(panelAlphaForLuminance(0)).toBe(0.32);
    expect(panelAlphaForLuminance(1)).toBe(0.86);
    expect(panelAlphaForLuminance(0.6)).toBeGreaterThan(panelAlphaForLuminance(0.3));
    // Nilai di luar 0..1 tidak menghasilkan alpha aneh.
    expect(panelAlphaForLuminance(-3)).toBe(0.32);
    expect(panelAlphaForLuminance(99)).toBe(0.86);
  });
});

describe('thumbnail.util — judul', () => {
  it('menghapus URL, mention, email, dan telepon sebelum judul dipakai', () => {
    const clean = sanitizeTitleText(
      'Besok @kantin tutup! Hubungi 081234567890 / admin@kampus.ac.id https://x.test'
    );
    expect(clean).not.toMatch(/@kantin|0812|admin@|https/);
    expect(clean).toContain('Besok');
  });

  it('mengambil 3–5 kata pertama dan membuang kata pengisi', () => {
    const title = fallbackTitle('Jadi aku tadi telat masuk kelas karena ban bocor di jalan');
    expect(title.split(' ').length).toBeGreaterThanOrEqual(3);
    expect(title.split(' ').length).toBeLessThanOrEqual(5);
    expect(title.toLowerCase()).not.toMatch(/^jadi/);
  });

  it('memotong judul pada 60 karakter tanpa memotong kata', () => {
    const title = fallbackTitle('Kata '.repeat(40));
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith(' ')).toBe(false);
  });

  it('memberi judul cadangan bila konten kosong atau hanya simbol', () => {
    expect(fallbackTitle('')).toBe(FALLBACK_TITLE);
    expect(fallbackTitle('!!! ??? ...')).toBe(FALLBACK_TITLE);
  });

  it('auto-fit mengecilkan font sampai judul muat dalam 4 baris', () => {
    const fitted = fitTitle('Ketika kantin tutup lebih awal dari biasanya', {
      maxWidth: 500,
      maxFontSize: 96,
      minFontSize: 44,
      measure: (text, size) => text.length * size * 0.6,
    });
    expect(fitted.fits).toBe(true);
    expect(fitted.lines.length).toBeLessThanOrEqual(4);
    expect(fitted.fontSize).toBeLessThanOrEqual(96);
    expect(fitted.fontSize).toBeGreaterThanOrEqual(44);
  });

  it('menambahkan elipsis bila teks tetap tidak muat di ukuran minimum', () => {
    const fitted = fitTitle('Sangat '.repeat(40), {
      maxWidth: 220,
      maxFontSize: 64,
      minFontSize: 44,
      maxLines: 2,
      measure: (text, size) => text.length * size * 0.6,
    });
    expect(fitted.fits).toBe(false);
    expect(fitted.lines).toHaveLength(2);
    expect(fitted.lines[1].endsWith('…')).toBe(true);
  });

  it('menurunkan font agar baris terakhir tidak berisi satu kata (widow)', () => {
    const fitted = fitTitle('alpha beta gamma delta epsilon', {
      maxWidth: 130,
      maxLines: 3,
      maxFontSize: 40,
      minFontSize: 16,
      step: 4,
      maxCharsPerLine: 80,
      measure: (text, size) => text.length * size * 0.5,
    });
    const lastLine = fitted.lines[fitted.lines.length - 1];
    expect(lastLine.split(' ').length).toBeGreaterThan(1);
    expect(fitted.fontSize).toBeLessThan(40);
  });

  it('tetap memakai font terbesar bila widow tidak bisa dihindari', () => {
    // Dengan lebar ini tidak ada ukuran font yang menghasilkan baris akhir ≥ 2 kata.
    const fitted = fitTitle('alpha beta gamma delta epsilon', {
      maxWidth: 120,
      maxLines: 3,
      maxFontSize: 40,
      minFontSize: 16,
      step: 4,
      maxCharsPerLine: 80,
      measure: (text, size) => text.length * size * 0.5,
    });
    expect(fitted.fits).toBe(true);
    expect(fitted.fontSize).toBe(20);
  });
});

describe('thumbnail.util — watermark & opt-out', () => {
  it('memakai handle base (bukan penulis) dan host tanpa protokol', () => {
    expect(watermarkLabel('unermenfess', 'https://fessncurious.vercel.app/')).toEqual({
      handle: '@unermenfess',
      host: 'fessncurious.vercel.app',
    });
    expect(watermarkLabel('@base', '')).toMatchObject({ handle: '@base' });
  });

  it('hanya auto/no_ai yang mengizinkan thumbnail', () => {
    expect(isThumbnailModeAllowed('auto')).toBe(true);
    expect(isThumbnailModeAllowed('no_ai')).toBe(true);
    expect(isThumbnailModeAllowed('off')).toBe(false);
    expect(isThumbnailModeAllowed(null)).toBe(true);
  });
});