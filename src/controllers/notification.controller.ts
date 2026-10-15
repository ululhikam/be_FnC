import { Request, Response, NextFunction } from 'express';
import { NotificationService } from '../services/notification.service.js';
import { successResponse, errorResponse } from '../utils/response.util.js';

export class NotificationController {
  static async getNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }

      const result = await NotificationService.getNotifications(req.user.id, req.query as any);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async markNotificationsRead(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }

      const { ids } = req.body;
      const result = await NotificationService.markAsRead(req.user.id, ids);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async markAllRead(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }

      const result = await NotificationService.markAllAsRead(req.user.id);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async deleteNotification(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }

      const result = await NotificationService.deleteNotification(
        req.user.id,
        String(req.params.id)
      );
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }
}
