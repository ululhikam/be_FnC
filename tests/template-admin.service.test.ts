import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/prisma.js', () => {
  const client: any = {
    template: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
    },
    base: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((arg: any) =>
    typeof arg === 'function' ? arg(client) : Promise.all(arg)
  );
  return { prisma: client };
});

vi.mock('../src/utils/template-admin.util.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/template-admin.util.js')>();
  return { ...actual, analyzeTemplateSvg: vi.fn() };
});

vi.mock('../src/services/canvas.service.js', () => ({
  CanvasService: {
    renderTemplateThumbnail: vi.fn(() => Buffer.from('<svg/>')),
  },
}));

vi.mock('../src/services/storage.service.js', () => ({
  StorageService: {
    uploadBuffer: vi.fn(),
  },
}));

vi.mock('../src/services/admin-security.service.js', () => ({
  AdminSecurityService: {
    writeAudit: vi.fn(),
  },
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => {
    const chain: any = {
      resize: vi.fn(() => chain),
      png: vi.fn(() => chain),
      toBuffer: vi.fn(async () => Buffer.from('png')),
    };
    return chain;
  }),
}));

import { TemplateAdminService } from '../src/services/template-admin.service.js';
import { analyzeTemplateSvg } from '../src/utils/template-admin.util.js';
import { CanvasService } from '../src/services/canvas.service.js';
import { StorageService } from '../src/services/storage.service.js';
import { AdminSecurityService } from '../src/services/admin-security.service.js';
import { prisma } from '../src/config/prisma.js';

const NOW = new Date('2026-10-28T10:00:00.000Z');
const BASE = { id: 'base_a', handle: '@fess_a', name: 'Fess A' };

const SLOTS = {
  anchor: { x: 100, y: 200 },
  message: { maxWidth: 900, maxLines: 10, bottom: 800 },
  user: { x: 10, y: 20 },
  time: { x: 10, y: 20 },
  footer: { x: 10, y: 20 },
  flagged: [],
};

const ANALYSIS = {
  normalized: '<svg/>',
  bytes: 1024,
  checksum: 'checksum-v1',
  width: 1080,
  height: 1350,
  slots: SLOTS as any,
  palette: { bg: '#111111', ink: '#ffffff', accent: '#cdf22b' },
  warnings: [] as string[],
};

function adminRow(overrides: Record<string, any> = {}) {
  return {
    id: 'tpl_1',
    key: '13-papan-kampus',
    label: 'Papan Kampus',
    description: null,
    category: 'campus',
    renderer: 'svg',
    aspect: 'portrait',
    width: 1080,
    height: 1350,
    slots: SLOTS,
    palette: ANALYSIS.palette,
    thumbnailUrl: 'https://cdn.test/templates/13-papan-kampus-v1.png',
    checksum: 'checksum-v1',
    version: 1,
    status: 'draft',
    sortOrder: 10,
    baseId: null,
    base: null,
    createdById: 'usr_admin',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation((arg: any) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg)
  );
  vi.mocked(analyzeTemplateSvg).mockResolvedValue(ANALYSIS as any);
  vi.mocked(CanvasService.renderTemplateThumbnail).mockReturnValue(Buffer.from('<svg/>') as any);
  vi.mocked(StorageService.uploadBuffer).mockResolvedValue({
    url: 'https://cdn.test/templates/13-papan-kampus-v1.png',
  } as any);
  vi.mocked(AdminSecurityService.writeAudit).mockResolvedValue(undefined as any);
});

describe('TemplateAdminService.create', () => {
  it('menyimpan template bersama dengan thumbnail otomatis', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.template.aggregate).mockResolvedValueOnce({ _max: { sortOrder: 20 } } as any);
    vi.mocked(prisma.template.create).mockResolvedValueOnce(adminRow() as any);

    const result = await TemplateAdminService.create('usr_admin', {
      key: '13-papan-kampus',
      svg: '<svg/>',
      label: 'Papan Kampus',
    });

    expect(prisma.template.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: '13-papan-kampus',
          status: 'draft',
          baseId: null,
          sortOrder: 30,
          version: 1,
          thumbnailUrl: 'https://cdn.test/templates/13-papan-kampus-v1.png',
        }),
      })
    );
    expect(StorageService.uploadBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'templates/13-papan-kampus-v1.png' })
    );
    expect(result.base_id).toBeNull();
    expect(result.base_handle).toBeNull();
    expect(AdminSecurityService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TEMPLATE_CREATED',
        targetId: '13-papan-kampus',
        metadata: expect.objectContaining({ base_handle: null }),
      }),
      expect.anything()
    );
  });

  it('menetapkan base pemilik dan mencatatnya di audit', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.base.findUnique).mockResolvedValueOnce(BASE as any);
    vi.mocked(prisma.template.aggregate).mockResolvedValueOnce({ _max: { sortOrder: 0 } } as any);
    vi.mocked(prisma.template.create).mockResolvedValueOnce(
      adminRow({ baseId: BASE.id, base: BASE }) as any
    );

    const result = await TemplateAdminService.create(
      'usr_admin',
      {
        key: '13-papan-kampus',
        svg: '<svg/>',
        baseHandle: 'fess_a',
        status: 'active',
      },
      { ipAddress: '127.0.0.1', userAgent: 'vitest' }
    );

    expect(prisma.base.findUnique).toHaveBeenCalledWith({
      where: { handle: '@fess_a' },
      select: { id: true, handle: true, name: true },
    });
    expect(prisma.template.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ baseId: BASE.id, status: 'active' }),
      })
    );
    expect(result.base_handle).toBe('@fess_a');
    expect(AdminSecurityService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ base_handle: '@fess_a' }),
      }),
      expect.anything()
    );
  });

  it('menolak base yang tidak ditemukan sebelum menyimpan', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.base.findUnique).mockResolvedValueOnce(null);

    await expect(
      TemplateAdminService.create('usr_admin', {
        key: '13-papan-kampus',
        svg: '<svg/>',
        baseHandle: '@tidak-ada',
      })
    ).rejects.toMatchObject({
      code: 'BASE_NOT_FOUND',
      status: 422,
      errors: { base_handle: expect.any(String) },
    });

    expect(prisma.template.create).not.toHaveBeenCalled();
  });
});

describe('TemplateAdminService.update', () => {
  it('memindahkan template ke base lain', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValueOnce(adminRow() as any);
    vi.mocked(prisma.base.findUnique).mockResolvedValueOnce(BASE as any);
    vi.mocked(prisma.template.update).mockResolvedValueOnce(
      adminRow({ baseId: BASE.id, base: BASE }) as any
    );

    const result = await TemplateAdminService.update('usr_admin', '13-papan-kampus', {
      baseHandle: 'fess_a',
    });

    expect(prisma.template.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: '13-papan-kampus' },
        data: expect.objectContaining({ base: { connect: { id: BASE.id } } }),
      })
    );
    expect(result.base_handle).toBe('@fess_a');
    expect(AdminSecurityService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TEMPLATE_UPDATED',
        metadata: expect.objectContaining({
          previous_base_handle: null,
          base_handle: '@fess_a',
        }),
      }),
      expect.anything()
    );
  });

  it('mengembalikan template milik base menjadi katalog bersama', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValueOnce(
      adminRow({ baseId: BASE.id, base: BASE }) as any
    );
    vi.mocked(prisma.template.update).mockResolvedValueOnce(adminRow() as any);

    const result = await TemplateAdminService.update('usr_admin', '13-papan-kampus', {
      baseHandle: null,
    });

    expect(prisma.base.findUnique).not.toHaveBeenCalled();
    expect(prisma.template.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ base: { disconnect: true } }),
      })
    );
    expect(result.base_id).toBeNull();
  });

  it('menolak aktivasi template tanpa thumbnail', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValueOnce(
      adminRow({ thumbnailUrl: null }) as any
    );

    await expect(
      TemplateAdminService.update('usr_admin', '13-papan-kampus', { status: 'active' })
    ).rejects.toMatchObject({
      code: 'TEMPLATE_THUMBNAIL_REQUIRED',
      status: 409,
    });

    expect(prisma.template.update).not.toHaveBeenCalled();
  });
});

describe('TemplateAdminService.replaceSvg', () => {
  it('mempertahankan versi dan thumbnail bila checksum sama', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValueOnce(adminRow() as any);
    vi.mocked(prisma.template.update).mockResolvedValueOnce(adminRow() as any);

    const result = await TemplateAdminService.replaceSvg(
      'usr_admin',
      '13-papan-kampus',
      '<svg/>'
    );

    expect(CanvasService.renderTemplateThumbnail).not.toHaveBeenCalled();
    expect(StorageService.uploadBuffer).not.toHaveBeenCalled();
    expect(prisma.template.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 1 }),
      })
    );
    expect(result.version).toBe(1);
  });

  it('menaikkan versi dan merender thumbnail baru bila checksum berubah', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValueOnce(adminRow() as any);
    vi.mocked(analyzeTemplateSvg).mockResolvedValueOnce({
      ...ANALYSIS,
      checksum: 'checksum-v2',
    } as any);
    vi.mocked(prisma.template.update).mockResolvedValueOnce(
      adminRow({ version: 2, checksum: 'checksum-v2' }) as any
    );

    const result = await TemplateAdminService.replaceSvg(
      'usr_admin',
      '13-papan-kampus',
      '<svg>baru</svg>'
    );

    expect(StorageService.uploadBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'templates/13-papan-kampus-v2.png' })
    );
    expect(prisma.template.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 2, checksum: 'checksum-v2' }),
      })
    );
    expect(AdminSecurityService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TEMPLATE_SVG_REPLACED',
        metadata: expect.objectContaining({
          previous_version: 1,
          version: 2,
          checksum_changed: true,
        }),
      }),
      expect.anything()
    );
    expect(result.version).toBe(2);
  });
});

describe('TemplateAdminService.regenerateThumbnail', () => {
  it('merender ulang dari SVG tersimpan dan menambahkan cache-buster', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValueOnce({
      ...adminRow(),
      svgSource: '<svg/>',
    } as any);
    vi.mocked(prisma.template.update).mockImplementationOnce(async (args: any) =>
      adminRow({ thumbnailUrl: args.data.thumbnailUrl }) as any
    );

    const result = await TemplateAdminService.regenerateThumbnail(
      'usr_admin',
      '13-papan-kampus'
    );

    expect(CanvasService.renderTemplateThumbnail).toHaveBeenCalledWith(
      expect.objectContaining({ svgSource: '<svg/>', key: '13-papan-kampus' })
    );
    expect(StorageService.uploadBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'templates/13-papan-kampus-v1.png' })
    );
    expect(result.thumbnail_url).toMatch(
      /^https:\/\/cdn\.test\/templates\/13-papan-kampus-v1\.png\?rev=\d+$/
    );
    expect(AdminSecurityService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TEMPLATE_THUMBNAIL_REGENERATED' }),
      expect.anything()
    );
  });
});

describe('TemplateAdminService.archive', () => {
  it('mengarsipkan tanpa menghapus dan tetap menyimpan audit', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValueOnce(adminRow() as any);
    vi.mocked(prisma.template.update).mockResolvedValueOnce(
      adminRow({ status: 'archived' }) as any
    );

    const result = await TemplateAdminService.archive('usr_admin', '13-papan-kampus');

    expect(prisma.template.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'archived' } })
    );
    expect(result.status).toBe('archived');
    expect(AdminSecurityService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TEMPLATE_ARCHIVED',
        metadata: expect.objectContaining({ previous_status: 'draft' }),
      }),
      expect.anything()
    );
  });

  it('idempoten bila template sudah diarsipkan', async () => {
    vi.mocked(prisma.template.findUnique).mockResolvedValueOnce(
      adminRow({ status: 'archived' }) as any
    );

    const result = await TemplateAdminService.archive('usr_admin', '13-papan-kampus');

    expect(prisma.template.update).not.toHaveBeenCalled();
    expect(result.status).toBe('archived');
  });
});
