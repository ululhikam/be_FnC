import { Request, Response, NextFunction } from 'express';
import { PlatformAdminService } from '../services/platform-admin.service.js';
import { errorResponse, successResponse } from '../utils/response.util.js';

function requestMeta(req: Request) {
  return {
    ipAddress: req.ip || req.socket.remoteAddress || null,
    userAgent: req.get('user-agent') || null,
  };
}

export class PlatformAdminController {
  static async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const summary = await PlatformAdminService.getOpsSummary();
      return successResponse(res, summary, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getAuditLogs(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await PlatformAdminService.listAuditLogs(req.query as any);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getUsers(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await PlatformAdminService.listUsers(req.query as any);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async banUser(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await PlatformAdminService.banUser(
        req.user,
        String(req.params.id),
        {
          reason: req.body.reason,
          durationHours: req.body.duration_hours,
          password: req.body.password,
        },
        requestMeta(req)
      );
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async unbanUser(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await PlatformAdminService.unbanUser(
        req.user,
        String(req.params.id),
        {
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

  static async getBaseSupport(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await PlatformAdminService.getBaseSupport(String(req.params.handle));
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getPaymentOrders(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await PlatformAdminService.listPaymentOrders(req.query as any);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getPaymentOrder(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await PlatformAdminService.getPaymentOrder(String(req.params.id));
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getPaymentEvents(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await PlatformAdminService.listPaymentEvents(req.query as any);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getSystemSettings(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await PlatformAdminService.getSystemSettings();
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }
}
