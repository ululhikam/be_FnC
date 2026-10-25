import { Request, Response, NextFunction } from 'express';
import { BaseRevenueService } from '../services/base-revenue.service.js';
import { errorResponse, successResponse } from '../utils/response.util.js';

function requestMeta(req: Request) {
  return {
    ipAddress: req.ip || req.socket.remoteAddress || null,
    userAgent: req.get('user-agent') || null,
  };
}

export class BaseRevenueController {
  static async getWorkspace(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const baseHandle =
        typeof req.query.base_handle === 'string' ? req.query.base_handle : undefined;
      const workspace = await BaseRevenueService.getWorkspace(req.user, baseHandle);
      return successResponse(res, workspace, 200);
    } catch (error) {
      next(error);
    }
  }

  static async listPayouts(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const baseHandle =
        typeof req.query.base_handle === 'string' ? req.query.base_handle : undefined;
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const page = Number(req.query.page ?? 1);
      const limit = Number(req.query.limit ?? 20);
      const result = await BaseRevenueService.listPayouts(req.user, {
        status,
        baseHandle,
        q,
        page,
        limit,
      });
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async requestPayout(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const requestKey = req.get('Idempotency-Key');
      if (!requestKey) {
        return errorResponse(
          res,
          'Header Idempotency-Key wajib dikirim agar payout tidak dobel.',
          400,
          'IDEMPOTENCY_KEY_REQUIRED'
        );
      }

      const result = await BaseRevenueService.requestPayout(
        req.user,
        {
          amountIdr: Number(req.body.amount_idr),
          baseHandle: req.body.base_handle ?? null,
          requestKey,
          notes: req.body.notes ?? null,
        },
        requestMeta(req)
      );

      return successResponse(res, result, result.idempotent ? 200 : 201);
    } catch (error) {
      next(error);
    }
  }

  static async reviewPayout(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const payout = await BaseRevenueService.reviewPayout(
        req.user,
        String(req.params.id),
        req.body.action,
        {
          password: req.body.password ?? null,
          reason: req.body.reason ?? null,
          feeIdr: req.body.fee_idr,
          reference: req.body.reference ?? null,
        },
        requestMeta(req)
      );
      return successResponse(res, payout, 200);
    } catch (error) {
      next(error);
    }
  }

  static async updateBank(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const base = await BaseRevenueService.updateBank(
        req.user,
        {
          baseHandle: req.body.base_handle ?? null,
          bankName: req.body.bank_name,
          bankAccountName: req.body.bank_account_name,
          bankAccountNumber: req.body.bank_account_number,
          password: req.body.password,
        },
        requestMeta(req)
      );
      return successResponse(res, base, 200);
    } catch (error) {
      next(error);
    }
  }

  static async setKyc(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const base = await BaseRevenueService.setKyc(
        req.user,
        {
          baseHandle: req.body.base_handle,
          status: req.body.status,
          note: req.body.note ?? null,
          password: req.body.password,
        },
        requestMeta(req)
      );
      return successResponse(res, base, 200);
    } catch (error) {
      next(error);
    }
  }

  static async setFreeForever(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }
      const base = await BaseRevenueService.setFreeForever(
        req.user,
        {
          baseHandle: req.body.base_handle,
          freeForever: req.body.free_forever,
          reason: req.body.reason,
          password: req.body.password,
        },
        requestMeta(req)
      );
      return successResponse(res, base, 200);
    } catch (error) {
      next(error);
    }
  }
}
