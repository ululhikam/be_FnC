import { Request, Response, NextFunction } from 'express';
import { TemplateAdminService } from '../services/template-admin.service.js';
import { errorResponse, successResponse } from '../utils/response.util.js';

function requestMeta(req: Request) {
  return {
    ipAddress: req.ip || req.socket.remoteAddress || null,
    userAgent: req.get('user-agent') || null,
  };
}

export class TemplateAdminController {
  /** Semua template (draft/aktif/arsip) untuk tabel konsol Super Admin. */
  static async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const rows = await TemplateAdminService.list();
      return successResponse(res, { data: rows }, 200);
    } catch (error) {
      next(error);
    }
  }

  /** Import SVG baru; thumbnail dirender otomatis dari SVG yang sama. */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await TemplateAdminService.create(
        req.user.id,
        {
          key: req.body.key,
          svg: req.body.svg,
          label: req.body.label,
          description: req.body.description,
          category: req.body.category,
          status: req.body.status,
          sortOrder: req.body.sort_order,
          baseHandle: req.body.base_handle,
        },
        requestMeta(req)
      );
      return successResponse(res, result, 201);
    } catch (error) {
      next(error);
    }
  }

  /** Ubah metadata, status, dan/atau pemilik base. */
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await TemplateAdminService.update(
        req.user.id,
        String(req.params.key),
        {
          label: req.body.label,
          description: req.body.description,
          category: req.body.category,
          status: req.body.status,
          sortOrder: req.body.sort_order,
          baseHandle: req.body.base_handle,
        },
        requestMeta(req)
      );
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /** Ganti SVG sumber; versi naik bila checksum berubah. */
  static async replaceSvg(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await TemplateAdminService.replaceSvg(
        req.user.id,
        String(req.params.key),
        req.body.svg,
        requestMeta(req)
      );
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /** Usulkan metadata katalog dari SVG (tanpa menulis DB). */
  static async suggestMetadata(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await TemplateAdminService.suggestMetadata(
        req.user.id,
        {
          svg: req.body.svg,
          key: req.body.key,
          filename: req.body.filename,
        },
        requestMeta(req)
      );
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /** Render ulang thumbnail tanpa mengubah SVG/versi. */
  static async regenerateThumbnail(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await TemplateAdminService.regenerateThumbnail(
        req.user.id,
        String(req.params.key),
        requestMeta(req)
      );
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /** Arsipkan template (tidak hard-delete, fess lama tetap bisa dirender). */
  static async archive(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await TemplateAdminService.archive(
        req.user.id,
        String(req.params.key),
        requestMeta(req)
      );
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }
}
