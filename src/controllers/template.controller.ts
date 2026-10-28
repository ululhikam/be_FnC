import { Request, Response, NextFunction } from 'express';
import {
  TemplateService,
  type TemplateSummaryRecord,
} from '../services/template.service.js';
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
  };
}

export class TemplateController {
  /** Katalog template aktif — sumber pemilih template di composer. */
  static async listTemplates(req: Request, res: Response, next: NextFunction) {
    try {
      const rows = await TemplateService.listActive();
      return res.status(200).json({ data: rows.map(toSummary) });
    } catch (error) {
      next(error);
    }
  }

  /** Detail satu template (tanpa SVG/geometri). */
  static async getTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const key = String(req.params.key || '').trim();
      const record = key ? await TemplateService.getActive(key) : null;
      if (!record) {
        return errorResponse(res, `Template ${key || '-'} tidak ditemukan`, 404, 'NOT_FOUND');
      }
      return res.status(200).json(toSummary(record));
    } catch (error) {
      next(error);
    }
  }
}
