import { Request, Response, NextFunction } from 'express';
import { BaseService } from '../services/base.service.js';
import { FessService } from '../services/fess.service.js';
import { successResponse } from '../utils/response.util.js';

export class BaseController {
  static async getBases(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await BaseService.getBases(req.query as any, req.user?.id);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getBase(req: Request, res: Response, next: NextFunction) {
    try {
      const handle = String(req.params.handle);
      const base = await BaseService.getBaseByHandle(handle, req.user?.id);
      return successResponse(res, base, 200);
    } catch (error) {
      next(error);
    }
  }

  static async createBase(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Autentikasi diperlukan', code: 'UNAUTHORIZED' });
      }
      const base = await BaseService.createBase(req.user.id, req.body);
      return successResponse(res, base, 201);
    } catch (error) {
      next(error);
    }
  }

  static async followBase(req: Request, res: Response, next: NextFunction) {
    try {
      const handle = String(req.params.handle);
      if (!req.user) {
        return res.status(401).json({ message: 'Autentikasi dibutuhkan', code: 'UNAUTHORIZED' });
      }
      const result = await BaseService.toggleFollow(handle, req.user.id);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getBaseFesses(req: Request, res: Response, next: NextFunction) {
    try {
      const handle = String(req.params.handle);
      const result = await FessService.getFesses(
        {
          ...(req.query as any),
          base: handle,
        },
        req.user?.id
      );
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getBaseFollowers(req: Request, res: Response, next: NextFunction) {
    try {
      const handle = String(req.params.handle);
      const result = await BaseService.getBaseFollowers(handle, req.query as any);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async updateBaseSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const handle = String(req.params.handle);
      if (!req.user) {
        return res.status(401).json({ message: 'Autentikasi dibutuhkan', code: 'UNAUTHORIZED' });
      }
      const updated = await BaseService.updateSettings(handle, req.user, req.body);
      return successResponse(res, updated, 200);
    } catch (error) {
      next(error);
    }
  }
}
