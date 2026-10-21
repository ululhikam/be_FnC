import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import sharp from 'sharp';
import { StorageService } from '../src/services/storage.service.js';
import {
  assertCarouselGeometry,
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

    // Area pad atas harus putih; bagian tengah tetap merah (tidak ter-crop).
    const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return [data[offset], data[offset + 1], data[offset + 2]];
    };
    expect(pixel(10, 10)).toEqual([255, 255, 255]);
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
