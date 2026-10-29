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
        avatar:
          'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#0055ff"/></svg>'
          ),
      }),
    },
    template: {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

describe('POST /api/fesses/canvas/preview — pratinjau kartu composer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.template.findUnique).mockResolvedValue(null);
  });

  it('mengembalikan PNG data URI dari renderer yang sama dengan auto-post', async () => {
    const res = await request(app).post('/api/fesses/canvas/preview').send({
      base_handle: '@concern_fess',
      content: 'Halo, ini pratinjau kartu fess yang harus sama dengan hasil render.',
      template: 'default',
      tag: 'Cerita',
      topic: 'cinta',
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

  it('menolak base yang tidak ditemukan', async () => {
    vi.mocked(prisma.base.findUnique).mockResolvedValueOnce(null as any);

    const res = await request(app).post('/api/fesses/canvas/preview').send({
      base_handle: '@base_tidak_ada',
      content: 'Pratinjau tanpa base harus ditolak.',
      template: 'default',
    });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('menolak template milik base lain', async () => {
    const key = 'uji-preview-milik-base-lain';
    vi.mocked(prisma.template.findUnique).mockResolvedValueOnce({
      id: 'tpl_other',
      key,
      status: 'active',
      baseId: 'base_002',
      renderer: 'generative',
    } as any);

    const res = await request(app).post('/api/fesses/canvas/preview').send({
      base_handle: '@concern_fess',
      content: 'Template eksklusif base lain tidak boleh dipratinjau.',
      template: key,
    });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors?.template).toContain('tidak tersedia untuk base ini');
  });

  it('menolak template draft milik base sendiri', async () => {
    const key = 'uji-preview-template-draft';
    vi.mocked(prisma.template.findUnique).mockResolvedValueOnce({
      id: 'tpl_draft',
      key,
      status: 'draft',
      baseId: 'base_001',
      renderer: 'generative',
    } as any);

    const res = await request(app).post('/api/fesses/canvas/preview').send({
      base_handle: '@concern_fess',
      content: 'Template draft belum boleh dipakai.',
      template: key,
    });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('mengizinkan template aktif milik base sendiri', async () => {
    const key = 'uji-preview-template-aktif';
    vi.mocked(prisma.template.findUnique).mockResolvedValueOnce({
      id: 'tpl_owned',
      key,
      status: 'active',
      baseId: 'base_001',
      renderer: 'generative',
    } as any);

    const res = await request(app).post('/api/fesses/canvas/preview').send({
      base_handle: '@concern_fess',
      content: 'Template aktif milik base ini boleh dipratinjau.',
      template: key,
    });

    expect(res.status).toBe(200);
    expect(res.body.images.length).toBeGreaterThanOrEqual(1);
  });

  it('mengizinkan template aktif dari katalog bersama', async () => {
    const key = 'uji-preview-template-bersama';
    vi.mocked(prisma.template.findUnique).mockResolvedValueOnce({
      id: 'tpl_shared',
      key,
      status: 'active',
      baseId: null,
      renderer: 'generative',
    } as any);

    const res = await request(app).post('/api/fesses/canvas/preview').send({
      base_handle: '@concern_fess',
      content: 'Template katalog bersama boleh dipratinjau semua base.',
      template: key,
    });

    expect(res.status).toBe(200);
    expect(res.body.images.length).toBeGreaterThanOrEqual(1);
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
