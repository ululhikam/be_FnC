import { Request, Response, NextFunction } from 'express';
import {
  AdminNotificationService,
  type BroadcastAudience,
} from '../services/admin-notification.service.js';
import { errorResponse, successResponse } from '../utils/response.util.js';

function requestMeta(req: Request) {
  return {
    ipAddress: req.ip || req.socket.remoteAddress || null,
    userAgent: req.get('user-agent') || null,
  };
}

/**
 * Blast notifikasi sistem dari konsol Super Admin.
 *
 * Pratinjau hanya menghitung penerima. Pengiriman butuh konfirmasi kata sandi
 * dan alasan, lalu dicatat di audit.
 */
export class AdminNotificationController {
  static async preview(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await AdminNotificationService.preview(
        (req.body.audience ?? 'users') as BroadcastAudience
      );
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async broadcast(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await AdminNotificationService.broadcast(
        req.user.id,
        {
          title: req.body.title,
          body: req.body.body,
          audience: req.body.audience ?? 'users',
          reason: req.body.reason,
          password: req.body.password,
        },
        requestMeta(req)
      );
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }
}