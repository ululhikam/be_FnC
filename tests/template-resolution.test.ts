import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FessService } from '../src/services/fess.service.js';
import { TemplateService } from '../src/services/template.service.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    template: { findUnique: vi.fn() },
  },
}));

function row(key: string) {
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
  };
}

describe('FessService.resolveTemplateKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TemplateService.invalidate();
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
});
