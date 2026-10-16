import { Request, Response, NextFunction } from 'express';
import { FessService } from '../services/fess.service.js';
import { CanvasService } from '../services/canvas.service.js';
import { successResponse, errorResponse } from '../utils/response.util.js';

export class FessController {
  static async getFesses(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await FessService.getFesses(req.query as any, req.user?.id);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async createFess(req: Request, res: Response, next: NextFunction) {
    try {
      const fess = await FessService.createFess(req.body, req.user?.id);
      return successResponse(res, fess, 201);
    } catch (error) {
      next(error);
    }
  }

  static async getFess(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const fess = await FessService.getFessById(id, req.user?.id);
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
      const approved = await FessService.approveFess(id, req.user);
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
      const { template, aspect } = req.body || {};
      const result = await CanvasService.exportFessCanvas(id, template, aspect || 'portrait');
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }
}
