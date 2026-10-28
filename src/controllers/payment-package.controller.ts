import { Request, Response, NextFunction } from 'express';
import { PaymentPackageService } from '../services/payment-package.service.js';
import { errorResponse, successResponse } from '../utils/response.util.js';

function requestMeta(req: Request) {
  return {
    ipAddress: req.ip || req.socket.remoteAddress || null,
    userAgent: req.get('user-agent') || null,
  };
}

export class PaymentPackageController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await PaymentPackageService.listForAdmin();
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const pkg = await PaymentPackageService.create(
        req.user,
        {
          code: req.body.code,
          name: req.body.name,
          amountIdr: req.body.amount_idr,
          ctfAmount: req.body.ctf_amount,
          description: req.body.description ?? '',
          sortOrder: req.body.sort_order,
          isActive: req.body.is_active,
          reason: req.body.reason,
          password: req.body.password,
        },
        requestMeta(req)
      );
      return successResponse(res, pkg, 201);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const pkg = await PaymentPackageService.update(
        req.user,
        String(req.params.code),
        {
          name: req.body.name,
          amountIdr: req.body.amount_idr,
          ctfAmount: req.body.ctf_amount,
          description: req.body.description ?? '',
          sortOrder: req.body.sort_order,
          isActive: req.body.is_active,
          reason: req.body.reason,
          password: req.body.password,
        },
        requestMeta(req)
      );
      return successResponse(res, pkg, 200);
    } catch (error) {
      next(error);
    }
  }

  static async setStatus(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const pkg = await PaymentPackageService.setActive(
        req.user,
        String(req.params.code),
        {
          isActive: req.body.is_active,
          reason: req.body.reason,
          password: req.body.password,
        },
        requestMeta(req)
      );
      return successResponse(res, pkg, 200);
    } catch (error) {
      next(error);
    }
  }
}