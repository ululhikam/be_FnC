import { Request, Response, NextFunction } from 'express';
import { UserService } from '../services/user.service.js';
import { FessService } from '../services/fess.service.js';
import { BaseService } from '../services/base.service.js';
import { successResponse, errorResponse } from '../utils/response.util.js';

export class UserController {
  static async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = String(req.params.userId);
      const result = await UserService.getProfile(userId);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }
      const result = await UserService.updateProfile(req.user.id, req.body);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getMyFesses(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }
      const result = await FessService.getUserFesses(req.user.id, req.query as any);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getMyBookmarks(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }
      const result = await FessService.getBookmarkedFesses(
        req.user.id,
        req.query as any,
        req.user
      );
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getFollowingBases(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan', 401, 'UNAUTHORIZED');
      }
      const result = await BaseService.getFollowingBases(req.user.id, req.query as any);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
