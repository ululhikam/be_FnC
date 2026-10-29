import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import sharp from 'sharp';
import { StorageService } from '../src/services/storage.service.js';
import {
  assertCarouselGeometry,
  buildWatermarkSvg,
  ensureJpegUrl,
  normalizeImageBuffer,
} from '../src/utils/instagram-media.util.js';

vi.mock('axios', () => ({
  default: { head: vi.fn(), get: vi.fn(), post: vi.fn() },
}));

vi.mock('../src/services/storage.service.js', () => ({
  StorageService: { uploadMedia: vi.fn() },
}));

describe('ensureJpegUrl — Instagram hanya menerima gambar JPEG', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(StorageService.uploadMedia).mockResolvedValue({
      url: 'https://storage.supabase.co/confess-media/ig-jpeg/hasil.jpg',
      size: 1234,
      type: 'image',
    } as any);
  });

  it('URL .jpg dipakai apa adanya — tanpa request jaringan', async () => {
    const out = await ensureJpegUrl('https://cdn.example.com/foto.jpg');
    expect(out).toBe('https://cdn.example.com/foto.jpg');
    expect(axios.head).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
    expect(StorageService.uploadMedia).not.toHaveBeenCalled();
  });

  it('URL tanpa ekstensi tapi content-type sudah JPEG → dipakai apa adanya', async () => {
    vi.mocked(axios.head).mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'image/jpeg; charset=binary' },
    } as any);

    const out = await ensureJpegUrl('https://cdn.example.com/media/abc123');
    expect(out).toBe('https://cdn.example.com/media/abc123');
    expect(StorageService.uploadMedia).not.toHaveBeenCalled();
  });

  it('PNG dikonversi → diunggah sebagai JPEG → URL baru dikembalikan', async () => {
    const png = await sharp({
      create: {
        width: 24,
        height: 24,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();

    vi.mocked(axios.head).mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'image/png' },
    } as any);
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: png,
      headers: { 'content-type': 'image/png' },
    } as any);

    const out = await ensureJpegUrl('https://cdn.example.com/kartu.png');
    expect(out).toContain('ig-jpeg/hasil.jpg');

    const uploadedFile = vi.mocked(StorageService.uploadMedia).mock.calls[0][0] as any;
    expect(uploadedFile.mimetype).toBe('image/jpeg');
    expect(uploadedFile.originalname).toMatch(/\.jpg$/);
    // magic number JPEG (FF D8) — bukti buffer benar-benar JPEG
    expect(uploadedFile.buffer[0]).toBe(0xff);
    expect(uploadedFile.buffer[1]).toBe(0xd8);
  });

  it('data-URI / non-http dilewatkan tanpa perubahan', async () => {
    const out = await ensureJpegUrl('data:image/png;base64,xxxx');
    expect(out).toBe('data:image/png;base64,xxxx');
    expect(StorageService.uploadMedia).not.toHaveBeenCalled();
  });

  it('gagal unduh → error jelas & tidak di-cache (percobaan kedua mencoba lagi)', async () => {
    vi.mocked(axios.head).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'image/png' },
    } as any);
    vi.mocked(axios.get).mockRejectedValue(new Error('network down'));

    await expect(ensureJpegUrl('https://cdn.example.com/rusak.png')).rejects.toThrow(
      'Gagal mengunduh'
    );
    await expect(ensureJpegUrl('https://cdn.example.com/rusak.png')).rejects.toThrow();
    expect(vi.mocked(axios.get).mock.calls.length).toBe(2);
  });
});

describe('normalisasi geometri carousel Instagram 4:5', () => {
  it('foto persegi dipad ke 1080×1350 tanpa crop (konten tetap utuh)', async () => {
    const square = await sharp({
      create: { width: 800, height: 800, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer();

    const jpeg = await normalizeImageBuffer(square);
    const meta = await sharp(jpeg).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);

    // Area pad mengikuti warna foto (salinan blur), bukan putih polos.
    const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return [data[offset], data[offset + 1], data[offset + 2]];
    };
    const [padR, padG, padB] = pixel(10, 10);
    expect(padR).toBeGreaterThan(140);
    expect(padG).toBeLessThan(90);
    expect(padB).toBeLessThan(90);
    expect(Math.min(padR, padG, padB)).toBeLessThan(200); // bukan putih
    const [r, g, b] = pixel(540, 675);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });

  it('semua item dengan 1080×1350 lolos; ukuran campuran ditolak', () => {
    expect(() =>
      assertCarouselGeometry([
        { type: 'image', width: 1080, height: 1350 },
        { type: 'video', width: 1080, height: 1350, duration: 20 },
      ])
    ).not.toThrow();

    expect(() =>
      assertCarouselGeometry([
        { type: 'image', width: 1080, height: 1350 },
        { type: 'image', width: 1080, height: 1080 },
      ])
    ).toThrow(/semua item Instagram harus 1080×1350/);

    expect(() =>
      assertCarouselGeometry([{ type: 'video', url: 'https://cdn.example.com/a.mp4' }])
    ).toThrow(/metadata dimensi/);
  });
});

describe('watermark foto asli Instagram', () => {
  const WATERMARK = { handle: '@unermenfess', host: 'fessncurious.vercel.app' };

  /** Foto uji solid gelap-sedang: teks putih mudah dibedakan dari latar. */
  async function photo(): Promise<Buffer> {
    return sharp({
      create: { width: 1200, height: 900, channels: 3, background: '#553311' },
    })
      .png()
      .toBuffer();
  }

  async function pixels(jpeg: Buffer) {
    const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    return {
      info,
      at(x: number, y: number) {
        const offset = (y * info.width + x) * info.channels;
        return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
      },
      /** Jumlah piksel putih teks di dalam kotak. */
      countBright(x0: number, y0: number, x1: number, y1: number) {
        let count = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const offset = (y * info.width + x) * info.channels;
            if (Math.min(data[offset], data[offset + 1], data[offset + 2]) > 190) count++;
          }
        }
        return count;
      },
    };
  }

  it('handle base tampil di kiri-atas, host platform di kanan-bawah', async () => {
    const withMark = await pixels(await normalizeImageBuffer(await photo(), undefined, { watermark: WATERMARK }));
    const without = await pixels(await normalizeImageBuffer(await photo()));

    // Sama sekali tidak ada teks putih tanpa watermark.
    expect(without.countBright(40, 30, 620, 110)).toBe(0);
    expect(without.countBright(560, 1240, 1040, 1320)).toBe(0);

    // Dengan watermark: ada glyph putih di kedua sudut.
    expect(withMark.countBright(40, 30, 620, 110)).toBeGreaterThan(40);
    expect(withMark.countBright(560, 1240, 1040, 1320)).toBeGreaterThan(20);
  });

  it('pill watermark hanya di sudut; bagian tengah foto tidak digelapkan', async () => {
    const plain = await pixels(await normalizeImageBuffer(await photo()));
    const marked = await pixels(
      await normalizeImageBuffer(await photo(), undefined, { watermark: WATERMARK })
    );

    const top = (p: ReturnType<typeof plain.at>) => p.r + p.g + p.b;
    // Pill solid di kiri-atas menggelapkan sudut, bukan seluruh lebar foto.
    expect(top(marked.at(150, 70))).toBeLessThan(top(plain.at(150, 70)));
    // Tengah & tepi kanan-atas (di luar pill) tetap sama.
    expect(top(marked.at(540, 675))).toBeCloseTo(top(plain.at(540, 675)), -1);
    expect(top(marked.at(1000, 70))).toBeCloseTo(top(plain.at(1000, 70)), -1);
  });

  it('watermark memakai pill solid dengan garis tepi putih', async () => {
    const jpeg = await normalizeImageBuffer(await photo(), undefined, { watermark: WATERMARK });
    const { at } = await pixels(jpeg);

    // Garis tepi atas pill handle (y≈48) lebih terang dari isi gelap di bawahnya.
    const stroke = at(150, 48);
    const fill = at(150, 60);
    expect(Math.min(stroke.r, stroke.g, stroke.b)).toBeGreaterThan(
      Math.min(fill.r, fill.g, fill.b) + 40
    );
    // Isi pill gelap pekat (bukan sekadar scrim tipis).
    expect(Math.max(fill.r, fill.g, fill.b)).toBeLessThan(120);
  });

  it('bingkai non-4:5 tetap berwarna foto (bukan putih) saat watermark aktif', async () => {
    const square = await sharp({
      create: { width: 800, height: 800, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer();

    const jpeg = await normalizeImageBuffer(square, undefined, { watermark: WATERMARK });
    const { at } = await pixels(jpeg);
    const edge = at(10, 300);
    expect(edge.r).toBeGreaterThan(120);
    expect(edge.g).toBeLessThan(90);
    expect(edge.b).toBeLessThan(90);
  });

  it('SVG watermark memuat handle base & host, bukan handle penulis', () => {
    const svg = buildWatermarkSvg({ width: 1080, height: 1350 }, WATERMARK);
    expect(svg).toContain('@unermenfess');
    expect(svg).toContain('fessncurious.vercel.app');
    expect(svg).toContain('text-anchor="end"');
  });

  it('watermark kosong tidak menggambar apa pun', async () => {
    const plain = await pixels(await normalizeImageBuffer(await photo()));
    const empty = await pixels(
      await normalizeImageBuffer(await photo(), undefined, { watermark: { handle: '', host: '' } })
    );
    expect(empty.countBright(40, 30, 620, 110)).toBe(0);
    expect(plain.countBright(40, 30, 620, 110)).toBe(0);
  });
});
