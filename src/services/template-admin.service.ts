import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { prisma } from '../config/prisma.js';
import { AdminSecurityService } from './admin-security.service.js';
import { CanvasService } from './canvas.service.js';
import { StorageService } from './storage.service.js';
import { TemplateService, type TemplateRecord, type TemplateSlots } from './template.service.js';
import { normalizeHandle } from '../utils/format.util.js';
import {
  analyzeTemplateSvg,
  TemplateAdminError,
  templateLabelFromKey,
  type TemplateSvgAnalysis,
} from '../utils/template-admin.util.js';

export type TemplateStatus = 'draft' | 'active' | 'archived';

export interface TemplateRequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreateTemplateInput {
  key: string;
  svg: string;
  label?: string;
  description?: string | null;
  category?: string;
  status?: 'draft' | 'active';
  sortOrder?: number;
  /** Handle base pemilik; kosong/null = katalog bersama. */
  baseHandle?: string | null;
}

export interface UpdateTemplateInput {
  label?: string;
  description?: string | null;
  category?: string;
  status?: TemplateStatus;
  sortOrder?: number;
  /** Kirim string untuk menetapkan pemilik, null untuk menjadikan bersama. */
  baseHandle?: string | null;
}

/** Kolom penuh yang dibutuhkan konsol admin (termasuk checksum & audit trail). */
const ADMIN_SELECT = {
  id: true,
  key: true,
  label: true,
  description: true,
  category: true,
  renderer: true,
  aspect: true,
  width: true,
  height: true,
  slots: true,
  palette: true,
  thumbnailUrl: true,
  checksum: true,
  version: true,
  status: true,
  sortOrder: true,
  baseId: true,
  base: { select: { handle: true, name: true, avatar: true, color: true } },
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

type AdminTemplateRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  category: string;
  renderer: string;
  aspect: string;
  width: number;
  height: number;
  slots: unknown;
  palette: unknown;
  thumbnailUrl: string | null;
  checksum: string | null;
  version: number;
  status: string;
  sortOrder: number;
  baseId: string | null;
  base: { handle: string; name: string; avatar: string | null; color: string } | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Lebar PNG katalog; rasio 4:5 mengikuti canvas template. */
const THUMBNAIL_WIDTH = 540;

function asSlots(value: unknown): TemplateSlots {
  return (value ?? {}) as TemplateSlots;
}

function asPalette(value: unknown): { bg?: string; ink?: string; accent?: string } | null {
  return (value ?? null) as { bg?: string; ink?: string; accent?: string } | null;
}

function serialise(row: AdminTemplateRow) {
  const slots = asSlots(row.slots);
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description ?? null,
    category: row.category,
    renderer: row.renderer,
    aspect: row.aspect,
    width: row.width,
    height: row.height,
    palette: asPalette(row.palette),
    thumbnail_url: row.thumbnailUrl ?? null,
    checksum: row.checksum ?? null,
    version: row.version,
    status: row.status,
    sort_order: row.sortOrder,
    base_id: row.baseId ?? null,
    base_handle: row.base?.handle ?? null,
    base_name: row.base?.name ?? null,
    base_avatar: row.base?.avatar ?? null,
    base_color: row.base?.color ?? null,
    created_by_id: row.createdById ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    slots_summary: {
      max_lines: slots.message?.maxLines ?? 0,
      has_quote: Boolean(slots.quote),
      has_user: Boolean(slots.user),
      has_time: Boolean(slots.time),
      has_footer: Boolean(slots.footer),
      warnings: slots.flagged ?? [],
    },
  };
}

function withRevision(url: string, revision: number): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}rev=${revision}`;
}

/**
 * Pemilik template: `null` berarti katalog bersama. Base harus ada; kalau tidak,
 * admin mendapat error field `base_handle` (bukan 500).
 */
async function resolveBaseOwner(raw?: string | null) {
  const rawHandle = String(raw ?? '').trim();
  if (!rawHandle) return null;

  const handle = normalizeHandle(rawHandle);
  const base = await prisma.base.findUnique({
    where: { handle },
    select: { id: true, handle: true, name: true },
  });
  if (!base) {
    throw new TemplateAdminError(
      'BASE_NOT_FOUND',
      `Base ${rawHandle} tidak ditemukan.`,
      422,
      { base_handle: 'Pilih base yang valid atau kosongkan untuk katalog bersama.' }
    );
  }
  return base;
}

async function findRow(key: string): Promise<AdminTemplateRow> {
  const row = (await prisma.template.findUnique({
    where: { key },
    select: ADMIN_SELECT,
  })) as AdminTemplateRow | null;

  if (!row) {
    throw new TemplateAdminError(
      'TEMPLATE_NOT_FOUND',
      `Template "${key}" tidak ditemukan.`,
      404
    );
  }
  return row;
}

/** Sama seperti `findRow`, tetapi ikut mengambil SVG sumber untuk render ulang. */
async function findRowWithSvg(key: string): Promise<AdminTemplateRow & { svgSource: string }> {
  const row = (await prisma.template.findUnique({
    where: { key },
    select: { ...ADMIN_SELECT, svgSource: true },
  })) as (AdminTemplateRow & { svgSource: string }) | null;

  if (!row) {
    throw new TemplateAdminError(
      'TEMPLATE_NOT_FOUND',
      `Template "${key}" tidak ditemukan.`,
      404
    );
  }
  return row;
}

function renderRecord(params: {
  key: string;
  label: string;
  description?: string | null;
  category: string;
  width: number;
  height: number;
  svgSource: string;
  slots: TemplateSlots;
  palette: TemplateRecord['palette'];
  version: number;
  status: string;
  sortOrder: number;
}): TemplateRecord {
  return {
    key: params.key,
    label: params.label,
    description: params.description ?? null,
    category: params.category,
    renderer: 'svg',
    aspect: 'portrait',
    width: params.width,
    height: params.height,
    svgSource: params.svgSource,
    slots: params.slots,
    palette: params.palette,
    thumbnailUrl: null,
    version: params.version,
    status: params.status,
    sortOrder: params.sortOrder,
  };
}

/**
 * Render halaman 1 template lalu simpan PNG-nya ke storage.
 *
 * Path deterministik `templates/<key>-v<version>.png` membuat thumbnail baru
 * menimpa versi yang sama (upsert), sementara versi SVG baru memakai path baru
 * sehingga cache CDN/browser tidak menyajikan gambar lama.
 */
async function renderAndUploadThumbnail(
  record: TemplateRecord,
  options: { revision?: number } = {}
): Promise<string> {
  let png: Buffer;
  try {
    const fullSize = CanvasService.renderTemplateThumbnail(record);
    png = await sharp(fullSize)
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (error: any) {
    throw new TemplateAdminError(
      'TEMPLATE_RENDER_FAILED',
      `Thumbnail gagal dirender: ${error?.message || error}`,
      422
    );
  }

  try {
    const uploaded = await StorageService.uploadBuffer({
      path: `templates/${record.key}-v${record.version}.png`,
      buffer: png,
      contentType: 'image/png',
    });
    return options.revision ? withRevision(uploaded.url, options.revision) : uploaded.url;
  } catch (error: any) {
    throw new TemplateAdminError(
      'TEMPLATE_THUMBNAIL_FAILED',
      `Thumbnail gagal diunggah ke storage: ${error?.message || error}`,
      502
    );
  }
}

function analysisMetadata(analysis: TemplateSvgAnalysis) {
  return {
    bytes: analysis.bytes,
    checksum: analysis.checksum,
    width: analysis.width,
    height: analysis.height,
    warnings: analysis.warnings.length,
  };
}

export class TemplateAdminService {
  /** Semua template, termasuk draft dan arsip, untuk tabel konsol admin. */
  static async list(): Promise<ReturnType<typeof serialise>[]> {
    const rows = (await prisma.template.findMany({
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      select: ADMIN_SELECT,
    })) as AdminTemplateRow[];
    return rows.map(serialise);
  }

  /**
   * Import SVG baru. Template langsung diukur dan thumbnail-nya dirender dari
   * SVG yang sama, jadi tidak ada langkah manual/script yang perlu dijalankan.
   */
  static async create(
    actorId: string,
    input: CreateTemplateInput,
    meta: TemplateRequestMeta = {}
  ) {
    const key = String(input.key || '').trim();
    const existing = await prisma.template.findUnique({ where: { key }, select: { id: true } });
    if (existing) {
      throw new TemplateAdminError(
        'TEMPLATE_EXISTS',
        `Template "${key}" sudah ada. Gunakan "Ganti SVG" untuk memperbarui desainnya.`,
        409
      );
    }

    const analysis = await analyzeTemplateSvg(input.svg, key);
    const owner = await resolveBaseOwner(input.baseHandle);
    const status = input.status ?? 'draft';
    const sortOrder =
      typeof input.sortOrder === 'number' ? input.sortOrder : await TemplateAdminService.nextSortOrder();
    const label = (input.label || '').trim() || templateLabelFromKey(key);
    const category = (input.category || 'campus').trim().toLowerCase() || 'campus';
    const description = input.description?.trim() ? input.description.trim() : null;

    const renderRecordData = renderRecord({
      key,
      label,
      description,
      category,
      width: analysis.width,
      height: analysis.height,
      svgSource: analysis.normalized,
      slots: analysis.slots,
      palette: analysis.palette,
      version: 1,
      status,
      sortOrder,
    });
    const thumbnailUrl = await renderAndUploadThumbnail(renderRecordData);

    const created = await prisma.$transaction(async (tx) => {
      const row = (await tx.template.create({
        data: {
          key,
          label,
          description,
          category,
          renderer: 'svg',
          aspect: 'portrait',
          width: analysis.width,
          height: analysis.height,
          svgSource: analysis.normalized,
          slots: analysis.slots as unknown as Prisma.InputJsonValue,
          palette: analysis.palette
            ? (analysis.palette as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          thumbnailUrl,
          checksum: analysis.checksum,
          version: 1,
          status,
          sortOrder,
          baseId: owner?.id ?? null,
          createdById: actorId,
        },
        select: ADMIN_SELECT,
      })) as AdminTemplateRow;

      await AdminSecurityService.writeAudit(
        {
          actorId,
          action: 'TEMPLATE_CREATED',
          targetType: 'Template',
          targetId: key,
          metadata: {
            label,
            category,
            status,
            version: 1,
            base_handle: owner?.handle ?? null,
            ...analysisMetadata(analysis),
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        tx
      );

      return row;
    });

    TemplateService.invalidate(key);
    return serialise(created);
  }

  /** Ubah metadata/status tanpa menyentuh SVG maupun geometri. */
  static async update(
    actorId: string,
    key: string,
    input: UpdateTemplateInput,
    meta: TemplateRequestMeta = {}
  ) {
    const existing = await findRow(key);
    const data: Prisma.TemplateUpdateInput = {};

    if (input.label !== undefined) {
      const label = input.label.trim();
      if (!label) {
        throw new TemplateAdminError('TEMPLATE_INVALID', 'Label tidak boleh kosong.', 422, {
          label: 'Wajib diisi.',
        });
      }
      data.label = label;
    }
    if (input.description !== undefined) {
      data.description = input.description?.trim() ? input.description.trim() : null;
    }
    if (input.category !== undefined) {
      const category = input.category.trim().toLowerCase();
      if (!category) {
        throw new TemplateAdminError('TEMPLATE_INVALID', 'Kategori tidak boleh kosong.', 422, {
          category: 'Wajib diisi.',
        });
      }
      data.category = category;
    }
    if (input.status !== undefined) {
      if (input.status === 'active' && !existing.thumbnailUrl) {
        throw new TemplateAdminError(
          'TEMPLATE_THUMBNAIL_REQUIRED',
          'Template belum punya thumbnail. Regenerasi thumbnail sebelum mengaktifkannya.',
          409
        );
      }
      data.status = input.status;
    }
    if (input.sortOrder !== undefined) {
      data.sortOrder = input.sortOrder;
    }

    let ownerChange: Awaited<ReturnType<typeof resolveBaseOwner>> | undefined;
    if (input.baseHandle !== undefined) {
      ownerChange = await resolveBaseOwner(input.baseHandle);
      data.base = ownerChange
        ? { connect: { id: ownerChange.id } }
        : { disconnect: true };
    }

    if (Object.keys(data).length === 0) {
      return serialise(existing);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = (await tx.template.update({
        where: { key },
        data,
        select: ADMIN_SELECT,
      })) as AdminTemplateRow;

      await AdminSecurityService.writeAudit(
        {
          actorId,
          action: 'TEMPLATE_UPDATED',
          targetType: 'Template',
          targetId: key,
          metadata: {
            changed: Object.keys(data),
            previous_status: existing.status,
            status: row.status,
            previous_base_handle: existing.base?.handle ?? null,
            base_handle: row.base?.handle ?? null,
            version: row.version,
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        tx
      );

      return row;
    });

    TemplateService.invalidate(key);
    return serialise(updated);
  }

  /**
   * Ganti desain SVG. Versi naik hanya bila checksum berubah, sehingga
   * menyimpan ulang file yang sama tidak memutus cache template lama.
   */
  static async replaceSvg(
    actorId: string,
    key: string,
    svg: string,
    meta: TemplateRequestMeta = {}
  ) {
    const existing = await findRow(key);
    const analysis = await analyzeTemplateSvg(svg, key);
    const checksumChanged = existing.checksum !== analysis.checksum;
    const version = checksumChanged ? existing.version + 1 : existing.version;

    let thumbnailUrl = existing.thumbnailUrl;
    if (checksumChanged || !thumbnailUrl) {
      thumbnailUrl = await renderAndUploadThumbnail(
        renderRecord({
          key,
          label: existing.label,
          description: existing.description,
          category: existing.category,
          width: analysis.width,
          height: analysis.height,
          svgSource: analysis.normalized,
          slots: analysis.slots,
          palette: analysis.palette,
          version,
          status: existing.status,
          sortOrder: existing.sortOrder,
        })
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = (await tx.template.update({
        where: { key },
        data: {
          width: analysis.width,
          height: analysis.height,
          svgSource: analysis.normalized,
          slots: analysis.slots as unknown as Prisma.InputJsonValue,
          palette: analysis.palette
            ? (analysis.palette as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          checksum: analysis.checksum,
          version,
          thumbnailUrl,
        },
        select: ADMIN_SELECT,
      })) as AdminTemplateRow;

      await AdminSecurityService.writeAudit(
        {
          actorId,
          action: 'TEMPLATE_SVG_REPLACED',
          targetType: 'Template',
          targetId: key,
          metadata: {
            previous_version: existing.version,
            version,
            previous_checksum: existing.checksum,
            checksum_changed: checksumChanged,
            ...analysisMetadata(analysis),
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        tx
      );

      return row;
    });

    TemplateService.invalidate(key);
    return serialise(updated);
  }

  /** Render ulang thumbnail (mis. setelah environment/footer berubah). */
  static async regenerateThumbnail(
    actorId: string,
    key: string,
    meta: TemplateRequestMeta = {}
  ) {
    const existing = await findRowWithSvg(key);
    const slots = asSlots(existing.slots);
    const thumbnailUrl = await renderAndUploadThumbnail(
      renderRecord({
        key,
        label: existing.label,
        description: existing.description,
        category: existing.category,
        width: existing.width,
        height: existing.height,
        svgSource: existing.svgSource,
        slots,
        palette: asPalette(existing.palette),
        version: existing.version,
        status: existing.status,
        sortOrder: existing.sortOrder,
      }),
      { revision: Date.now() }
    );

    const updated = await prisma.$transaction(async (tx) => {
      const row = (await tx.template.update({
        where: { key },
        data: { thumbnailUrl },
        select: ADMIN_SELECT,
      })) as AdminTemplateRow;

      await AdminSecurityService.writeAudit(
        {
          actorId,
          action: 'TEMPLATE_THUMBNAIL_REGENERATED',
          targetType: 'Template',
          targetId: key,
          metadata: { version: row.version },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        tx
      );

      return row;
    });

    TemplateService.invalidate(key);
    return serialise(updated);
  }

  /**
   * Arsipkan template: hilang dari pemilih user, tetap tersimpan agar fess lama
   * masih bisa dirender dan bisa dipulihkan lewat PATCH status.
   */
  static async archive(actorId: string, key: string, meta: TemplateRequestMeta = {}) {
    const existing = await findRow(key);
    if (existing.status === 'archived') {
      return serialise(existing);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = (await tx.template.update({
        where: { key },
        data: { status: 'archived' },
        select: ADMIN_SELECT,
      })) as AdminTemplateRow;

      await AdminSecurityService.writeAudit(
        {
          actorId,
          action: 'TEMPLATE_ARCHIVED',
          targetType: 'Template',
          targetId: key,
          metadata: { previous_status: existing.status, version: row.version },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        tx
      );

      return row;
    });

    TemplateService.invalidate(key);
    return serialise(updated);
  }

  private static async nextSortOrder(): Promise<number> {
    const last = await prisma.template.aggregate({ _max: { sortOrder: true } });
    return (last._max.sortOrder ?? 0) + 10;
  }
}
