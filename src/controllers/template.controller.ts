import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import {
  TemplateService,
  type TemplateSummaryRecord,
} from '../services/template.service.js';
import { normalizeHandle } from '../utils/format.util.js';
import { errorResponse } from '../utils/response.util.js';

/**
 * Bentuk ringkas template untuk klien.
 *
 * `svgSource` dan `slots` sengaja tidak dikirim: frontend hanya menampilkan
 * pratinjau hasil render backend, jadi tidak perlu (dan tidak boleh) menggambar
 * ulang kartu sendiri. Geometri tetap satu sumber di tabel `Template`.
 */
function toSummary(template: TemplateSummaryRecord) {
  return {
    key: template.key,
    label: template.label,
    description: template.description ?? null,
    category: template.category ?? null,
    renderer: template.renderer,
    aspect: template.aspect,
    width: template.width,
    height: template.height,
    palette: template.palette,
    thumbnail_url: template.thumbnailUrl ?? null,
    version: template.version,
    sort_order: template.sortOrder,
    // null = katalog bersama; terisi = template khusus base tersebut.
    base_id: template.baseId ?? null,
  };
}

/** Resolve `?base_handle=` ke id base; null bila tidak dikirim. */
async function resolveBaseId(raw: unknown): Promise<string | null> {
  const handle = String(raw ?? '').trim();
  if (!handle) return null;

  const base = await prisma.base.findUnique({
    where: { handle: normalizeHandle(handle) },
    select: { id: true },
  });
  if (!base) {
    const error: any = new Error(`Base ${handle} tidak ditemukan`);
    error.status = 404;
    error.code = 'BASE_NOT_FOUND';
    throw error;
  }
  return base.id;
}

export class TemplateController {
  /**
   * Katalog template aktif untuk composer.
   *
   * Tanpa `base_handle`: hanya katalog bersama. Dengan `base_handle`: template
   * milik base itu + katalog bersama, sehingga template milik base lain tidak
   * pernah ikut terkirim.
   */
  static async listTemplates(req: Request, res: Response, next: NextFunction) {
    try {
      const baseId = await resolveBaseId(req.query.base_handle);
      const rows = baseId
        ? await TemplateService.listActiveForBase(baseId)
        : await TemplateService.listActive();
      return res.status(200).json({ data: rows.map(toSummary) });
    } catch (error) {
      next(error);
    }
  }

  /** Detail satu template (tanpa SVG/geometri), discoped ke base bila diminta. */
  static async getTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const key = String(req.params.key || '').trim();
      const baseId = await resolveBaseId(req.query.base_handle);
      const record = key
        ? baseId
          ? await TemplateService.getActiveForBase(key, baseId)
          : await TemplateService.getActive(key)
        : null;
      if (!record) {
        return errorResponse(res, `Template ${key || '-'} tidak ditemukan`, 404, 'NOT_FOUND');
      }
      return res.status(200).json(toSummary(record));
    } catch (error) {
      next(error);
    }
  }
}
