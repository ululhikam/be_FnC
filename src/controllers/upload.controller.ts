import { Request, Response, NextFunction } from 'express';
import { StorageService } from '../services/storage.service.js';
import { successResponse, errorResponse } from '../utils/response.util.js';

export class UploadController {
  static async uploadMedia(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        return errorResponse(res, 'File media tidak ditemukan dalam request', 400, 'NO_FILE');
      }

      const result = await StorageService.uploadMedia(req.file, 'media');
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Terbitkan signed upload URL agar klien mengunggah file besar (video >4,5MB)
   * langsung ke Supabase Storage — batas body request Vercel tidak dilalui.
   */
  static async signMediaUpload(req: Request, res: Response, next: NextFunction) {
    try {
      const filename = String(req.body?.filename || '').trim();
      if (!filename) {
        return errorResponse(res, 'Nama file wajib diisi.', 400, 'NO_FILENAME');
      }

      const result = await StorageService.createSignedMediaUpload({
        filename,
        contentType: req.body?.content_type,
        folder: 'media',
      });
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async uploadAvatar(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        return errorResponse(res, 'File foto profil tidak ditemukan', 400, 'NO_FILE');
      }

      const url = await StorageService.uploadAvatar(req.file);
      return successResponse(res, { url }, 200);
    } catch (error) {
      next(error);
    }
  }
}
