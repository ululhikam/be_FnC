import { readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeTemplateSvg,
  assertTemplateKey,
  MAX_TEMPLATE_SVG_BYTES,
  templateLabelFromKey,
} from '../src/utils/template-admin.util.js';

const TEMPLATE_SVG = readFileSync(
  new URL('../assets/templates/01-helpdesk-ticket.svg', import.meta.url),
  'utf8'
);

function thrown(fn: () => unknown): any {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

describe('assertTemplateKey', () => {
  it('menerima key slug dan memangkas spasi', () => {
    expect(assertTemplateKey('  13-papan-kampus  ')).toBe('13-papan-kampus');
  });

  it('menolak key dengan huruf besar, spasi, atau garis hubung di akhir', () => {
    expect(thrown(() => assertTemplateKey('Papan Kampus'))).toMatchObject({
      code: 'TEMPLATE_KEY_INVALID',
    });
    expect(thrown(() => assertTemplateKey('13-papan-'))).toMatchObject({
      code: 'TEMPLATE_KEY_INVALID',
    });
  });

  it('menolak key yang sudah dipakai template lama', () => {
    expect(thrown(() => assertTemplateKey('default'))).toMatchObject({
      code: 'TEMPLATE_KEY_RESERVED',
      status: 409,
    });
  });
});

describe('templateLabelFromKey', () => {
  it('membuang nomor urut dan merapikan huruf', () => {
    expect(templateLabelFromKey('13-papan-kampus')).toBe('Papan Kampus');
    expect(templateLabelFromKey('papan-kampus')).toBe('Papan Kampus');
  });
});

describe('analyzeTemplateSvg', () => {
  it('mengukur SVG 4:5 dan menurunkan slot, palette, serta checksum', async () => {
    const analysis = await analyzeTemplateSvg(TEMPLATE_SVG, '13-papan-kampus');

    expect(analysis.width).toBe(1080);
    expect(analysis.height).toBe(1350);
    expect(analysis.slots.anchor).toBeTruthy();
    expect(analysis.slots.message.maxLines).toBeGreaterThanOrEqual(1);
    expect(analysis.slots.message.maxWidth).toBeGreaterThan(0);
    expect(analysis.slots.user).toBeTruthy();
    expect(analysis.slots.time).toBeTruthy();
    expect(analysis.slots.footer).toBeTruthy();
    expect(analysis.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(analysis.palette).toBeTruthy();
    expect(analysis.normalized).not.toContain('@import');
    expect(analysis.bytes).toBeGreaterThan(0);
  });

  it('menolak SVG dengan script, event handler, atau referensi eksternal', async () => {
    const cases = [
      TEMPLATE_SVG.replace('</svg>', '<script>alert(1)</script></svg>'),
      TEMPLATE_SVG.replace('</svg>', '<rect onload="alert(1)"/></svg>'),
      TEMPLATE_SVG.replace('</svg>', '<image href="https://example.com/a.png"/></svg>'),
      TEMPLATE_SVG.replace('</svg>', '<rect fill="url(https://example.com/a.svg)"/></svg>'),
      `<!DOCTYPE svg>${TEMPLATE_SVG}`,
    ];

    for (const svg of cases) {
      await expect(analyzeTemplateSvg(svg, '13-papan-kampus')).rejects.toMatchObject({
        code: 'TEMPLATE_UNSAFE',
        status: 422,
      });
    }
  });

  it('menolak variasi penulisan berbahaya', async () => {
    const cases = [
      TEMPLATE_SVG.replace('</svg>', '<SCRIPT>alert(1)</SCRIPT></svg>'),
      TEMPLATE_SVG.replace('</svg>', '<foreignObject><div>x</div></foreignObject></svg>'),
      TEMPLATE_SVG.replace('</svg>', '<image HREF = https://example.com/a.png /></svg>'),
      TEMPLATE_SVG.replace('</svg>', '<rect fill="url(data:image/svg+xml;base64,AAA)"/></svg>'),
      TEMPLATE_SVG.replace('</svg>', '<image xlink:href="data:text/html;base64,AAA"/></svg>'),
    ];

    for (const svg of cases) {
      await expect(analyzeTemplateSvg(svg, '13-papan-kampus')).rejects.toMatchObject({
        code: 'TEMPLATE_UNSAFE',
        status: 422,
      });
    }
  });

  it('menolak HTML yang membungkus SVG dan file non-SVG', async () => {
    const html = `<html><body>${TEMPLATE_SVG}</body></html>`;
    await expect(analyzeTemplateSvg(html, '13-papan-kampus')).rejects.toMatchObject({
      code: 'TEMPLATE_INVALID',
      status: 422,
      errors: { svg: expect.stringContaining('HTML') },
    });

    await expect(analyzeTemplateSvg('bukan svg sama sekali', '13-papan-kampus')).rejects.toMatchObject(
      {
        code: 'TEMPLATE_INVALID',
        status: 422,
      }
    );
  });

  it('menerima deklarasi XML dan komentar sebelum elemen svg', async () => {
    const prolog = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- template uji -->\n${TEMPLATE_SVG}`;
    const analysis = await analyzeTemplateSvg(prolog, '13-papan-kampus');

    expect(analysis.width).toBe(1080);
    expect(analysis.height).toBe(1350);
  });

  it('menolak SVG yang bukan 4:5', async () => {
    const square = TEMPLATE_SVG.replace('height="1350"', 'height="1080"');
    await expect(analyzeTemplateSvg(square, '13-papan-kampus')).rejects.toMatchObject({
      code: 'TEMPLATE_ASPECT_INVALID',
      status: 422,
    });
  });

  it('menolak SVG yang kehilangan slot wajib', async () => {
    const withoutUser = TEMPLATE_SVG.replace('id="editable-user"', 'id="editable-user-hilang"');
    await expect(analyzeTemplateSvg(withoutUser, '13-papan-kampus')).rejects.toMatchObject({
      code: 'TEMPLATE_SLOTS_MISSING',
      errors: { svg: expect.stringContaining('#editable-user') },
    });
  });

  it('menolak SVG di atas batas ukuran sebelum diukur', async () => {
    const oversized = 'x'.repeat(MAX_TEMPLATE_SVG_BYTES + 1);
    await expect(analyzeTemplateSvg(oversized, '13-papan-kampus')).rejects.toMatchObject({
      code: 'TEMPLATE_TOO_LARGE',
      status: 422,
    });
  });

  it(
    'menerima seluruh template resmi di assets/templates',
    async () => {
      const dir = new URL('../assets/templates/', import.meta.url);
      const files = readdirSync(dir)
        .filter((file) => file.toLowerCase().endsWith('.svg'))
        .sort();

      expect(files.length).toBeGreaterThanOrEqual(12);

      for (const file of files) {
        const svg = readFileSync(new URL(file, dir), 'utf8');
        const key = `uji-${basename(file, '.svg')}`;
        const analysis = await analyzeTemplateSvg(svg, key);
        expect(analysis.width).toBe(1080);
        expect(analysis.height).toBe(1350);
        expect(analysis.checksum).toMatch(/^[a-f0-9]{64}$/);
      }
    },
    60_000
  );
});
