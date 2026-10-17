import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import sharp from 'sharp';
import { StorageService } from '../src/services/storage.service.js';
import { ensureJpegUrl } from '../src/utils/instagram-media.util.js';

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
