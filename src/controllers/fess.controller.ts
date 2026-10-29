import { Request, Response, NextFunction } from 'express';
import { FessService } from '../services/fess.service.js';
import { InstagramService } from '../services/instagram.service.js';
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
      const headerKey = req.get('Idempotency-Key');
      const idempotencyKey =
        headerKey?.trim() || (req.body?.idempotency_key as string | undefined)?.trim() || undefined;
      const fess = await FessService.createFess(
        { ...req.body, idempotency_key: idempotencyKey },
        req.user,
        trackBackground
      );
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
      const { base_handle, content, template, tag, topic, quoted_fess, media, with_thumbnail } =
        req.body;
      const handle = normalizeHandle(String(base_handle || ''));
      const base = await prisma.base.findUnique({ where: { handle } });

      if (!base) {
        const err: any = new Error(`Base ${base_handle} tidak ditemukan`);
        err.status = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }

      // Pratinjau wajib memakai resolver yang sama dengan pembuatan fess:
      // template draft/arsip atau milik base lain tidak boleh dirender, meski
      // endpoint ini hanya mengembalikan gambar dan tidak menyimpan data.
      const templateKey = await FessService.resolveTemplateKey(template, base.id);

      // Canvas memuat resvg/sharp/opentype (native & berat). Import dinamis
      // memastikan endpoint baca biasa tidak menanggung biaya cold start-nya.
      const { CanvasService } = await import('../services/canvas.service.js');
      const { images, hasThumbnail } = await CanvasService.renderPreviewImages(
        {
          content,
          baseHandle: handle,
          template: templateKey,
          tag: tag || null,
          topic: topic || null,
          quotedFess: quoted_fess || null,
          media: media || [],
          base: {
            id: base.id,
            name: base.name,
            initial: base.initial,
            igAccount: base.igAccount,
            avatar: base.avatar,
            color: base.color,
            thumbnailMode: (base as any).thumbnailMode,
            bannedWords: (base as any).bannedWords,
          },
        },
        templateKey,
        { withThumbnail: Boolean(with_thumbnail), media: media || [] }
      );

      return successResponse(
        res,
        {
          images,
          page_count: images.length,
          has_thumbnail: hasThumbnail,
        },
        200
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Buat ulang thumbnail cover (hanya saat `failed`/`idle`).
   *
   * Judul tidak bisa diedit siapa pun; endpoint ini murni pemulihan
   * operasional setelah render gagal atau fitur baru dinyalakan.
   */
  static async regenerateThumbnail(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const viewer = req.user;
      if (!viewer) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }

      const fess = await prisma.fess.findUnique({
        where: { id },
        include: {
          base: {
            select: {
              creatorId: true,
              id: true,
              name: true,
              thumbnailMode: true,
              bannedWords: true,
            },
          },
        },
      });
      if (!fess) {
        return errorResponse(res, 'Fess tidak ditemukan', 404, 'NOT_FOUND');
      }

      const postHandle = String(fess.baseHandle || '').replace(/^@/, '').toLowerCase();
      const managesBase =
        viewer.role === 'Super Admin' ||
        (viewer.role === 'Base Admin' &&
          ((viewer.managedBases || []).some(
            (handle: string) => String(handle).replace(/^@/, '').toLowerCase() === postHandle
          ) ||
            fess.base?.creatorId === viewer.id));
      if (!managesBase) {
        return errorResponse(
          res,
          'Anda tidak memiliki izin membuat thumbnail fess ini',
          403,
          'FORBIDDEN'
        );
      }

      const { ThumbnailService } = await import('../services/thumbnail.service.js');
      const { RateLimitService } = await import('../services/rate-limit.service.js');

      if (!ThumbnailService.isEnabled()) {
        return errorResponse(res, 'Fitur thumbnail sedang dimatikan.', 409, 'THUMBNAIL_DISABLED');
      }

      const status = fess.thumbnailStatus || 'idle';
      if (status !== 'failed' && status !== 'idle') {
        return errorResponse(
          res,
          'Thumbnail sudah dibuat. Judul cover bersifat final dan tidak dapat dibuat ulang.',
          409,
          'THUMBNAIL_NOT_REGENERABLE'
        );
      }

      const gate = await RateLimitService.consume(`thumbnail:regen:${id}`, 5, 60);
      if (!gate.allowed) {
        return errorResponse(
          res,
          `Terlalu banyak permintaan. Coba lagi dalam ${gate.retryAfterSeconds} detik.`,
          429,
          'RATE_LIMITED'
        );
      }

      const result = await ThumbnailService.ensure({
        id: fess.id,
        content: fess.content,
        baseHandle: fess.baseHandle,
        media: fess.media,
        base: fess.base as any,
        topic: (fess as any).topic,
        tag: (fess as any).tag,
        thumbnailUrl: fess.thumbnailUrl,
        thumbnailStatus: fess.thumbnailStatus,
        thumbnailSourceMediaId: fess.thumbnailSourceMediaId,
        thumbnailTitle: fess.thumbnailTitle,
        thumbnailVersion: fess.thumbnailVersion,
      });

      const refreshed = await prisma.fess.findUnique({
        where: { id },
        select: {
          thumbnailUrl: true,
          thumbnailTitle: true,
          thumbnailStatus: true,
          thumbnailError: true,
        },
      });

      if (result) {
        try {
          const { AdminSecurityService } = await import('../services/admin-security.service.js');
          await AdminSecurityService.writeAudit({
            actorId: viewer.id,
            action: 'fess.thumbnail.regenerate',
            targetType: 'Fess',
            targetId: id,
          });
        } catch {
          /* audit tidak boleh menggagalkan render */
        }
      }

      return successResponse(
        res,
        {
          thumbnail_url: refreshed?.thumbnailUrl || null,
          thumbnail_title: refreshed?.thumbnailTitle || null,
          thumbnail_status: refreshed?.thumbnailStatus || 'idle',
          thumbnail_error: refreshed?.thumbnailError || null,
        },
        200
      );
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

  static async getInstagramStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const status = await FessService.getInstagramStatus(id, req.user);
      return successResponse(res, status, 200);
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

  static async bookmarkFess(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan untuk menyimpan fess', 401, 'UNAUTHORIZED');
      }
      const result = await FessService.bookmarkFess(id, req.user.id);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async unbookmarkFess(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan untuk menghapus simpanan', 401, 'UNAUTHORIZED');
      }
      const result = await FessService.unbookmarkFess(id, req.user.id);
      return successResponse(res, result, 200);
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
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }
      const { fess_id, reason, note } = req.body;
      // `:id` di URL adalah sumber kebenaran; `fess_id` di body hanya fallback
      // klien lama. Tanpa ini, laporan bisa dibuat untuk fess yang tidak pernah
      // dilihat klien (parameter confusion).
      const targetId = String(req.params.id || fess_id);
      const result = await FessService.reportFess(targetId, reason, req.user.id, note);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getFessReports(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }
      const id = String(req.params.id);
      const result = await FessService.getFessReports(id, req.user);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async dismissFessReport(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }
      const id = String(req.params.id);
      const { reason } = req.body;
      const result = await FessService.dismissFessReport(id, req.user, reason);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async resolveFessReport(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }
      const id = String(req.params.id);
      const { reason } = req.body;
      const result = await FessService.resolveFessReport(id, req.user, reason);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async manualIgPost(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }
      const id = String(req.params.id);
      const { ig_post_url, note } = req.body;
      const result = await FessService.manualIgPost(id, ig_post_url, req.user, note);
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
      const result = await FessService.deleteFess(id, req.user);
      return successResponse(res, result, 200);
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
      const target = await FessService.assertCanManageFess(id, req.user);
      if (!(await InstagramService.hasActiveInstagramConnection({ creatorId: target.creatorId }))) {
        const message = `Fess #${id} hanya terbit di FnC karena Instagram ${target.baseHandle} belum terhubung.`;
        await InstagramService.updateFessIgState(id, {
          igStatus: 'skipped',
          igError: null,
        });
        return successResponse(
          res,
          {
            image_url: null,
            imageUrl: null,
            image_urls: [],
            imageUrls: [],
            card_count: 0,
            media_count: 0,
            ig_pending: false,
            posted_to: [],
            meta_published: false,
            retry_scheduled: false,
            skipped: true,
            ig_status: 'skipped',
            ig_error: null,
            message,
            base_ig: target.baseHandle,
          },
          200
        );
      }

      const { template } = req.body || {};
      // Semua posting Instagram selalu 4:5; jangan percayai aspect dari klien.
      const { CanvasService } = await import('../services/canvas.service.js');
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
