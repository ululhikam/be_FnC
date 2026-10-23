import { Request, Response, NextFunction } from 'express';
import { AdminService } from '../services/admin.service.js';
import { successResponse, errorResponse } from '../utils/response.util.js';

export class AdminController {
  static async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const stats = await AdminService.getStats(req.user);
      return successResponse(res, stats, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getModerationQueue(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const base = req.query.base as string;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await AdminService.getModerationQueue(req.user, base, page, limit);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async exportCanvas(req: Request, res: Response, next: NextFunction) {
    try {
      const { fess_id, template, aspect } = req.body;
      // Export admin hanya merender/mengunduh card — bukan trigger posting IG.
      const { CanvasService } = await import('../services/canvas.service.js');
      const result = await CanvasService.exportFessCanvas(fess_id, template, aspect, {
        autoPost: false,
      });
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getSystemHealth(req: Request, res: Response, next: NextFunction) {
    try {
      const health = await AdminService.getSystemHealth();
      return successResponse(res, health, 200);
    } catch (error) {
      next(error);
    }
  }

  static async updateSecurityControls(req: Request, res: Response, next: NextFunction) {
    try {
      const health = await AdminService.updateSecurityControls(req.body);
      return successResponse(res, health, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getEngineLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const source = req.query.source as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const result = await AdminService.getEngineLogs(source, limit);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async banUser(req: Request, res: Response, next: NextFunction) {
    try {
      const { user_id, reason, duration_hours } = req.body;
      const result = await AdminService.banUser(user_id, reason, duration_hours);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getPlatformConnections(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await AdminService.getPlatformConnections(req.user);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async togglePlatformConnection(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const platform = String(req.params.platform);
      const { action, account_handle } = req.body;

      const result = await AdminService.togglePlatformConnection(
        req.user,
        platform,
        action,
        account_handle
      );
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getTreasury(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const treasury = await AdminService.getTreasury(req.user);
      return successResponse(res, treasury, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getInstagramInsights(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const insights = await AdminService.getInstagramInsights(req.user);
      return successResponse(res, insights, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getInstagramMediaInsights(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const insights = await AdminService.getInstagramMediaInsights(req.user);
      return successResponse(res, insights, 200);
    } catch (error) {
      next(error);
    }
  }

  static async requestPayout(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const { amount, destination } = req.body;
      const result = await AdminService.requestPayout(req.user, amount, destination);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }
}
