import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanvasService } from '../src/services/canvas.service.js';
import { prisma } from '../src/config/prisma.js';
import { ENV } from '../src/config/env.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    template: { findUnique: vi.fn() },
  },
}));

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND_HOST = new URL(ENV.FRONTEND_URL).host;
const GEOMETRY: any[] = Object.values(
  JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'docs/template-geometry.json'), 'utf8'))
);

/**
 * Template sungguhan (SVG di `assets/templates` + geometri hasil ukur) dibentuk
 * seperti baris tabel `Template`, jadi test ini ikut menjaga hasil import.
 */
function realTemplate(index: number) {
  const g = GEOMETRY[index];
  return {
    key: g.key,
    label: g.key,
    description: null,
    category: 'campus',
    renderer: 'svg',
    aspect: 'portrait',
    width: g.canvas.width,
    height: g.canvas.height,
    svgSource: fs.readFileSync(path.join(BACKEND_ROOT, 'assets/templates', g.file), 'utf8'),
    slots: {
      anchor: g.anchor,
      message: g.message,
      quote: g.quote,
      user: g.user,
      time: g.time,
      meta: g.meta,
      footer: g.footer,
      obstacles: g.obstacles,
      flagged: g.flags,
    },
    palette: null,
    thumbnailUrl: null,
    version: 1,
    status: 'active',
    sortOrder: index + 1,
  };
}

const QUOTE = {
  handle: '@anonim',
  content: 'kalian yang di lift tadi pagi, aku yang bawa kopi dua gelas itu hehe.',
  time: '25 Okt 2026 · 18:46 WIB',
};

const CREATED_AT = new Date('2026-10-25T11:46:00.000Z');

/** Teks yang benar-benar tampil (tag SVG dibuang, entitas di-decode). */
function plain(svg: string): string {
  return svg
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** `count` baris pendek, satu baris = satu paragraf (tanpa word-wrap). */
function lines(count: number): string {
  return Array.from({ length: count }, (_, i) => `Baris ${i + 1}`).join('\n');
}

async function render(
  template: ReturnType<typeof realTemplate>,
  content: string,
  quote: typeof QUOTE | null = null
): Promise<string[]> {
  vi.mocked(prisma.template.findUnique).mockResolvedValue(template as any);
  return CanvasService.buildPages(
    {
      content,
      baseHandle: 'fess_kampus',
      template: template.key,
      createdAt: CREATED_AT,
      quotedFess: quote,
      base: { igAccount: 'fess_kampus' },
    },
    template.key
  );
}

describe('Renderer template SVG (database)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('satu baris pendek cukup satu halaman tanpa badge halaman', async () => {
    const pages = await render(realTemplate(0), 'Halo kampus.');
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('<svg');
    expect(pages[0]).not.toContain('1/1');
    expect(plain(pages[0])).toContain('Halo kampus.');
  });

  it('30 baris mengalir ke beberapa halaman sesuai kapasitas template', async () => {
    // Template 01 muat 6 baris/halaman (tanpa kutipan).
    const pages = await render(realTemplate(0), lines(30));
    expect(pages).toHaveLength(5);
    expect(plain(pages[0])).toContain('Baris 1');
    expect(plain(pages[4])).toContain('Baris 30');
    // Badge halaman muncul di semua halaman ketika carousel > 1.
    for (const [idx, svg] of pages.entries()) {
      expect(svg).toContain(`>${idx + 1}/5</text>`);
    }
  });

  it('konten sangat panjang dibatasi 10 halaman dan ditutup elipsis', async () => {
    const pages = await render(realTemplate(0), lines(200));
    expect(pages).toHaveLength(10);
    expect(plain(pages.at(-1)!)).toContain('\u2026');
    expect(pages.at(-1)).toContain('10/10');
  });

  it('kutipan dirender sebagai kotak ber-frame sesuai slot terukur', async () => {
    const template = realTemplate(0);
    const pages = await render(template, 'Halo kampus.', QUOTE);
    const q = template.slots.quote;

    expect(pages[0]).toContain(
      `<rect x="${q.x}" y="${q.y}" width="${q.width}" height="${q.height}"`
    );
    expect(plain(pages[0])).toContain('KUTIPAN \u00b7 @ANONIM');
    expect(plain(pages[0])).toContain('kopi dua gelas');
    // Kutipan hanya di halaman pertama.
    const restPages = await render(template, lines(12), QUOTE);
    expect(restPages.length).toBeGreaterThan(1);
    expect(plain(restPages[1])).not.toContain('KUTIPAN');
  });

  it('kutipan sangat panjang dipotong dengan elipsis di dalam kotak', async () => {
    const longQuote = { ...QUOTE, content: 'kalimat kutipan panjang '.repeat(40) };
    const pages = await render(realTemplate(0), 'Halo kampus.', longQuote);
    expect(plain(pages[0])).toContain('\u2026');
  });

  it('kutipan mengurangi kapasitas baris halaman pertama', async () => {
    const template = realTemplate(0);
    const withoutQuote = await render(template, lines(30));
    const withQuote = await render(template, lines(30), QUOTE);
    expect(withQuote.length).toBeGreaterThan(withoutQuote.length);
  });

  it('footer kartu hanya berisi host frontend, bukan "Instagram Feed" atau handle base', async () => {
    const pages = await render(realTemplate(0), 'Halo kampus.');
    const text = plain(pages[0]);
    expect(text).toContain(FRONTEND_HOST);
    expect(text).not.toContain('Instagram Feed');
    expect(text).not.toContain('myfess.id');
    // Handle base cukup sekali di baris `@user`.
    expect(text.match(/@fess_kampus/g)).toHaveLength(1);
  });

  it('renderTemplateThumbnail menghasilkan PNG 1080x1350', () => {
    const png = CanvasService.renderTemplateThumbnail(realTemplate(0), {
      frontendHost: 'contoh.test',
    });
    expect(png.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1350);
  });

  it('thumbnail memakai contoh deterministik dan host footer bisa dioverride', () => {
    let svg = '';
    const spy = vi.spyOn(CanvasService, 'renderSvgToPng').mockImplementation((value) => {
      svg = value;
      return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    });

    try {
      CanvasService.renderTemplateThumbnail(realTemplate(0), { frontendHost: 'contoh.test' });
      const text = plain(svg);
      expect(text).toContain('contoh.test');
      expect(text).toContain('@fess_kampus');
      expect(text).toContain('KUTIPAN');
      expect(text).toContain('Ada yang mau belajar bareng');
    } finally {
      spy.mockRestore();
    }
  });

  it('handle & waktu memakai data fess, bukan teks contoh desain', async () => {
    const pages = await render(realTemplate(0), 'Halo kampus.');
    expect(pages[0]).not.toContain('@ustfess');
    expect(plain(pages[0])).toContain('@fess_kampus');
    // Waktu Jakarta (UTC+7) & pemisah titik tengah seperti teks contoh.
    expect(plain(pages[0])).toContain('25 Okt 2026 \u00b7 18.46 WIB');
  });

  it('ke-12 template merender halaman 1 tanpa teks contoh tersisa', async () => {
    expect(GEOMETRY).toHaveLength(12);
    for (let i = 0; i < GEOMETRY.length; i += 1) {
      const template = realTemplate(i);
      const pages = await render(template, 'Curhat singkat untuk uji render.', QUOTE);
      const svg = pages[0];
      const text = plain(svg);
      expect(svg, template.key).toContain('<svg');
      expect(text, template.key).toContain('Curhat singkat untuk uji render.');
      expect(text, template.key).toContain(FRONTEND_HOST);
      expect(text, template.key).not.toContain('Instagram Feed');
      expect(svg, template.key).not.toContain('myfess.id');
      expect(svg, template.key).not.toContain('@ustfess');
      expect(svg, template.key).not.toContain('id="editable-message"');
    }
  });

  it('fallback ke renderer lama bila template tidak ada di database', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValue(null);
    const pages = await CanvasService.buildPages({
      content: 'Template lama tetap bisa dirender.',
      baseHandle: 'fess_kampus',
      template: 'midnight',
      base: { igAccount: 'fess_kampus' },
    });
    expect(pages.length).toBeGreaterThanOrEqual(1);
    expect(plain(pages[0])).toContain('Instagram Feed \u00b7 @fess_kampus');
  });
});
