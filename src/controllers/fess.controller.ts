import { Request, Response, NextFunction } from 'express';
import { FessService } from '../services/fess.service.js';
import { CanvasService } from '../services/canvas.service.js';
import { prisma } from '../config/prisma.js';
import { normalizeHandle } from '../utils/format.util.js';
import { trackBackground } from '../utils/background.js';
import { successResponse, errorResponse } from '../utils/response.util.js';

export class FessController {
  static async getFesses(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await FessService.getFesses(req.query as any, req.user?.id, req.user);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async createFess(req: Request, res: Response, next: NextFunction) {
    try {
      const fess = await FessService.createFess(req.body, req.user?.id, trackBackground);
      return successResponse(res, fess, 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Pratinjau kartu fess untuk modal konfirmasi posting.
   *
   * Memakai renderer kanvas yang sama dengan auto-post, jadi gambar PNG yang
   * dikembalikan identik dengan hasil yang nanti diposting ke Instagram.
   */
  static async previewCanvas(req: Request, res: Response, next: NextFunction) {
    try {
      const { base_handle, content, template, tag, quoted_fess } = req.body;
      const handle = normalizeHandle(String(base_handle || ''));
      const base = await prisma.base.findUnique({ where: { handle } });

      const images = CanvasService.renderPreviewImages(
        {
          content,
          baseHandle: handle,
          template,
          tag: tag || null,
          quotedFess: quoted_fess || null,
          base: base
            ? { name: base.name, initial: base.initial, igAccount: base.igAccount }
            : null,
        },
        template
      );

      return successResponse(res, { images, page_count: images.length }, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getFess(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const fess = await FessService.getFessById(id, req.user?.id, req.user);
      return successResponse(res, fess, 200);
    } catch (error) {
      next(error);
    }
  }

  static async voteFess(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan untuk vote', 401, 'UNAUTHORIZED');
      }
      const updated = await FessService.voteFess(id, req.body.type, req.user.id, req.user.username);
      return successResponse(res, updated, 200);
    } catch (error) {
      next(error);
    }
  }

  static async approveFess(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }
      const approved = await FessService.approveFess(id, req.user, trackBackground);
      return successResponse(res, approved, 200);
    } catch (error) {
      next(error);
    }
  }

  static async rejectFess(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }
      const rejected = await FessService.rejectFess(id, req.user);
      return successResponse(res, rejected, 200);
    } catch (error) {
      next(error);
    }
  }

  static async reportFess(req: Request, res: Response, next: NextFunction) {
    try {
      const { fess_id, reason, note } = req.body;
      const result = await FessService.reportFess(fess_id, reason, note, req.user?.id);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async deleteFess(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }
      await FessService.deleteFess(id, req.user);
      return res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  static async postToInstagram(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }
      await FessService.assertCanManageFess(id, req.user);

      const { template } = req.body || {};
      // Semua posting Instagram selalu 4:5; jangan percayai aspect dari klien.
      const result = await CanvasService.exportFessCanvas(id, template, 'portrait');

      // Ratakan hasil auto-post agar UI (modal FessCard) bisa membaca
      // meta_published / message / image_url tanpa nesting ig_result.
      const ig = result.ig_result || {};
      return successResponse(
        res,
        {
          image_url: result.image_url,
          imageUrl: result.image_url,
          image_urls: result.image_urls,
          imageUrls: result.image_urls,
          card_count: result.card_count,
          media_count: result.media_count,
          ig_pending: ig.ig_pending === true,
          posted_to: result.posted_to,
          meta_published: ig.meta_published === true,
          retry_scheduled: ig.retry_scheduled === true,
          ig_status:
            ig.ig_status ||
            (ig.meta_published
              ? 'published'
              : ig.ig_pending
                ? 'pending'
                : ig.retry_scheduled
                  ? 'processing'
                  : 'failed'),
          ig_error: ig.error || null,
          message: ig.message || ig.error || `Card fess ${id} berhasil dirender.`,
          base_ig: ig.base_ig,
          ig_result: ig,
        },
        200
      );
    } catch (error) {
      next(error);
    }
  }
}
