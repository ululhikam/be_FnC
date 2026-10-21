import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    base: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'base_001',
        name: 'Concern Fess',
        handle: '@concern_fess',
        initial: 'CF',
        igAccount: '@concern_fess',
      }),
    },
  },
}));

describe('POST /api/fesses/canvas/preview — pratinjau kartu composer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mengembalikan PNG data URI dari renderer yang sama dengan auto-post', async () => {
    const res = await request(app).post('/api/fesses/canvas/preview').send({
      base_handle: '@concern_fess',
      content: 'Halo, ini pratinjau kartu fess yang harus sama dengan hasil render.',
      template: 'default',
      tag: 'Cerita',
    });

    expect(res.status).toBe(200);
    expect(res.body.page_count).toBe(res.body.images.length);
    expect(res.body.images.length).toBeGreaterThanOrEqual(1);
    expect(res.body.images[0]).toMatch(/^data:image\/png;base64,/);

    // Pratinjau komposer harus 1080×1350 (4:5), sama dengan hasil auto-post.
    const png = Buffer.from(res.body.images[0].split(',')[1], 'base64');
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);

    expect(prisma.base.findUnique).toHaveBeenCalledWith({
      where: { handle: '@concern_fess' },
    });
  });

  it('merender template solid (legacy) tanpa error', async () => {
    const res = await request(app).post('/api/fesses/canvas/preview').send({
      base_handle: 'concern_fess',
      content: 'Template senja solid tanpa gradient.',
      template: 'sunset',
      quoted_fess: {
        id: 'fess_quote_1',
        handle: '@anonim',
        content: 'Kutipan singkat.',
        time: '2 jam',
        avatar_bg: '#0038ff',
        avatar_text: 'AN',
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.images.length).toBeGreaterThanOrEqual(1);
    expect(prisma.base.findUnique).toHaveBeenCalledWith({
      where: { handle: '@concern_fess' },
    });
  });

  it('menolak konten kosong', async () => {
    const res = await request(app).post('/api/fesses/canvas/preview').send({
      base_handle: '@concern_fess',
      content: '',
      template: 'default',
    });

    expect(res.status).toBe(422);
  });
});
