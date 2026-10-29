import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import dns from 'node:dns/promises';
import {
  assertPublicHost,
  isBlockedAddress,
  isPublicHttpUrl,
} from '../src/utils/remote-image.util.js';

describe('isBlockedAddress', () => {
  it('menolak alamat privat, loopback, dan metadata cloud', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('meloloskan alamat publik', () => {
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('1.1.1.1')).toBe(false);
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false);
  });

  it('menganggap teks yang bukan IP literal sebagai tidak aman', () => {
    expect(isBlockedAddress('example.com')).toBe(true);
  });
});

describe('isPublicHttpUrl', () => {
  it('menolak protokol selain http(s) dan host internal', () => {
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('http://localhost/x.png')).toBe(false);
    expect(isPublicHttpUrl('http://service.internal/x.png')).toBe(false);
    expect(isPublicHttpUrl('http://127.0.0.1/x.png')).toBe(false);
  });

  it('meloloskan URL publik', () => {
    expect(isPublicHttpUrl('https://cdn.example.com/foto.png')).toBe(true);
    expect(isPublicHttpUrl('https://8.8.8.8/foto.png')).toBe(true);
  });
});

describe('assertPublicHost (SEC-25)', () => {
  let lookupSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    lookupSpy = vi.spyOn(dns, 'lookup');
  });

  afterEach(() => {
    lookupSpy.mockRestore();
  });

  it('menolak domain yang hasil resolusi DNS-nya alamat internal', async () => {
    // Nama domain publik yang menunjuk ke metadata cloud.
    lookupSpy.mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as any);

    await expect(assertPublicHost('metadata.example.com')).rejects.toThrow(/internal/i);
  });

  it('menolak bila salah satu alamat hasil resolusi internal', async () => {
    lookupSpy.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ] as any);

    await expect(assertPublicHost('campur.example.com')).rejects.toThrow(/internal/i);
  });

  it('meloloskan domain yang seluruh alamatnya publik', async () => {
    lookupSpy.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

    await expect(assertPublicHost('cdn.example.com')).resolves.toBeUndefined();
  });

  it('menolak host yang gagal di-resolve', async () => {
    lookupSpy.mockRejectedValue(new Error('ENOTFOUND'));

    await expect(assertPublicHost('tidak-ada.example')).rejects.toThrow(/resolve/i);
  });

  it('menolak bentuk numerik yang menunjuk loopback tanpa lookup DNS', async () => {
    // `2130706433` = 127.0.0.1 dalam bentuk desimal; resolver sistem
    // menerjemahkannya, jadi hasil resolusi yang diperiksa.
    lookupSpy.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);

    await expect(assertPublicHost('2130706433')).rejects.toThrow(/internal/i);
  });

  it('menolak IP literal internal tanpa memanggil resolver', async () => {
    await expect(assertPublicHost('127.0.0.1')).rejects.toThrow(/tidak diizinkan/i);
    expect(lookupSpy).not.toHaveBeenCalled();
  });
});
