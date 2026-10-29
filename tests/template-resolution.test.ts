import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FessService } from '../src/services/fess.service.js';
import { TemplateService } from '../src/services/template.service.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    template: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

function row(key: string, baseId: string | null = null) {
  return {
    key,
    label: key,
    description: null,
    category: 'campus',
    renderer: 'svg',
    aspect: 'portrait',
    width: 1080,
    height: 1350,
    svgSource: '<svg/>',
    slots: {},
    palette: null,
    thumbnailUrl: null,
    version: 1,
    status: 'active',
    sortOrder: 1,
    baseId,
  };
}

describe('FessService.resolveTemplateKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TemplateService.invalidate();
    vi.mocked(prisma.template.count).mockResolvedValue(0);
  });

  it('menerima key template lama tanpa menyentuh database', async () => {
    await expect(FessService.resolveTemplateKey('midnight')).resolves.toBe('midnight');
    await expect(FessService.resolveTemplateKey('default')).resolves.toBe('default');
    expect(prisma.template.findUnique).not.toHaveBeenCalled();
  });

  it('menerima template SVG yang aktif di database', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValue(row('01-helpdesk-ticket') as any);
    await expect(FessService.resolveTemplateKey('01-helpdesk-ticket')).resolves.toBe(
      '01-helpdesk-ticket'
    );
  });

  it('menolak key yang tidak ada di database maupun daftar lama', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValue(null);
    await expect(FessService.resolveTemplateKey('template-hantu')).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      errors: { template: expect.stringContaining('template-hantu') },
    });
  });

  it('menolak template yang statusnya bukan active', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValue({
      ...row('13-arsip'),
      status: 'archived',
    } as any);
    await expect(FessService.resolveTemplateKey('13-arsip')).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
    });
  });

  it('menerima template milik base tujuan', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValue(
      row('13-papan-kampus', 'base_a') as any
    );
    await expect(
      FessService.resolveTemplateKey('13-papan-kampus', 'base_a')
    ).resolves.toBe('13-papan-kampus');
  });

  it('menolak template milik base lain', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValue(
      row('13-papan-kampus', 'base_b') as any
    );
    await expect(
      FessService.resolveTemplateKey('13-papan-kampus', 'base_a')
    ).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      errors: { template: expect.stringContaining('tidak tersedia untuk base ini') },
    });
  });

  it('template bersama tetap bisa dipakai base yang belum punya template khusus', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValue(row('13-papan-kampus') as any);
    await expect(
      FessService.resolveTemplateKey('13-papan-kampus', 'base_a')
    ).resolves.toBe('13-papan-kampus');
  });

  it('menolak template generatif lama bila base sudah punya template khusus', async () => {
    vi.mocked(prisma.template.count).mockResolvedValue(1);
    await expect(FessService.resolveTemplateKey('midnight', 'base_a')).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      errors: { template: expect.stringContaining('midnight') },
    });
  });

  it('menolak template bersama bila base sudah punya template khusus', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValue(row('01-bersama') as any);
    vi.mocked(prisma.template.count).mockResolvedValue(1);

    await expect(FessService.resolveTemplateKey('01-bersama', 'base_a')).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
    });
  });

  it('mengganti `default` dengan template khusus pertama milik base', async () => {
    vi.mocked(prisma.template.count).mockResolvedValue(1);
    vi.mocked(prisma.template.findMany).mockResolvedValue([
      row('13-papan-kampus', 'base_a'),
    ] as any);

    await expect(FessService.resolveTemplateKey('default', 'base_a')).resolves.toBe(
      '13-papan-kampus'
    );
  });
});

describe('TemplateService scoping per base', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TemplateService.invalidate();
    vi.mocked(prisma.template.count).mockResolvedValue(0);
  });

  it('getActiveForBase menolak template milik base lain', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValue(
      row('13-papan-kampus', 'base_b') as any
    );
    await expect(
      TemplateService.getActiveForBase('13-papan-kampus', 'base_a')
    ).resolves.toBeNull();
  });

  it('listActive hanya mengambil katalog bersama', async () => {
    vi.mocked(prisma.template.findMany).mockResolvedValue([row('01-bersama')] as any);

    const rows = await TemplateService.listActive();

    expect(prisma.template.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'active', baseId: null } })
    );
    expect(rows.map((item) => item.key)).toEqual(['01-bersama']);
  });

  it('listActiveForBase hanya mengirim template khusus bila base sudah punya', async () => {
    vi.mocked(prisma.template.findMany).mockResolvedValue([
      row('01-bersama'),
      row('13-papan-kampus', 'base_a'),
      row('14-papan-kampus-2', 'base_a'),
    ] as any);

    const rows = await TemplateService.listActiveForBase('base_a');

    expect(prisma.template.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'active',
          OR: [{ baseId: 'base_a' }, { baseId: null }],
        },
      })
    );
    expect(rows.map((item) => item.key)).toEqual(['13-papan-kampus', '14-papan-kampus-2']);
  });

  it('listActiveForBase tetap mengirim katalog bersama bila base belum punya template khusus', async () => {
    vi.mocked(prisma.template.findMany).mockResolvedValue([
      row('01-bersama'),
      row('02-bersama'),
    ] as any);

    const rows = await TemplateService.listActiveForBase('base_a');

    expect(rows.map((item) => item.key)).toEqual(['01-bersama', '02-bersama']);
  });

  it('getActiveForBase menolak template bersama bila base sudah punya template khusus', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValue(row('01-bersama') as any);
    vi.mocked(prisma.template.count).mockResolvedValue(2);

    await expect(TemplateService.getActiveForBase('01-bersama', 'base_a')).resolves.toBeNull();
  });

  it('getActiveForBase masih menerima template khusus milik base', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValue(
      row('13-papan-kampus', 'base_a') as any
    );
    vi.mocked(prisma.template.count).mockResolvedValue(1);

    await expect(
      TemplateService.getActiveForBase('13-papan-kampus', 'base_a')
    ).resolves.toMatchObject({ key: '13-papan-kampus' });
  });

  it('listActiveForBase tanpa base kembali ke katalog bersama', async () => {
    vi.mocked(prisma.template.findMany).mockResolvedValue([row('01-bersama')] as any);

    const rows = await TemplateService.listActiveForBase('');

    expect(prisma.template.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'active', baseId: null } })
    );
    expect(rows).toHaveLength(1);
  });
});
