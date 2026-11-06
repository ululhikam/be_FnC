import { Request, Response, NextFunction } from 'express';
import { PaymentGatewayService } from '../services/payment-gateway.service.js';
import { errorResponse, successResponse } from '../utils/response.util.js';

function requestMeta(req: Request) {
  return {
    ipAddress: req.ip || req.socket.remoteAddress || null,
    userAgent: req.get('user-agent') || null,
  };
}

export class PaymentGatewayController {
  static async show(_req: Request, res: Response, next: NextFunction) {
    try {
      const result = await PaymentGatewayService.getAdminView();
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const result = await PaymentGatewayService.setMode(
        req.user,
        {
          mode: req.body.mode,
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
