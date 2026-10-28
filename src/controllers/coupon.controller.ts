import { Request, Response, NextFunction } from 'express';
import { CouponService, type CouponInput } from '../services/coupon.service.js';
import { errorResponse, successResponse } from '../utils/response.util.js';

function requestMeta(req: Request) {
  return {
    ipAddress: req.ip || req.socket.remoteAddress || null,
    userAgent: req.get('user-agent') || null,
  };
}

function bodyToInput(body: Record<string, unknown>): CouponInput {
  return {
    label: (body.label as string | null | undefined) ?? '',
    discountType: body.discount_type as CouponInput['discountType'],
    discountValue: Number(body.discount_value),
    maxDiscountIdr:
      body.max_discount_idr == null ? null : Number(body.max_discount_idr),
    minAmountIdr: body.min_amount_idr == null ? 0 : Number(body.min_amount_idr),
    startsAt: (body.starts_at as string | null | undefined) ?? null,
    endsAt: (body.ends_at as string | null | undefined) ?? null,
    maxRedemptions:
      body.max_redemptions == null ? null : Number(body.max_redemptions),
    isActive: body.is_active == null ? undefined : Boolean(body.is_active),
    reason: String(body.reason ?? ''),
    password: (body.password as string | null | undefined) ?? null,
  };
}

export class CouponController {
  static async preview(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) return errorResponse(res, 'Bukan pengguna', 403, 'FORBIDDEN');
      const quote = await CouponService.preview(req.user, {
        code: String(req.body.code),
        packageCode: String(req.body.package_code),
      });
      return successResponse(res, quote, 200);
    } catch (error) {
      next(error);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      const result = await CouponService.listForAdmin();
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      const coupon = await CouponService.create(
        req.user,
        { code: String(req.body.code), ...bodyToInput(req.body) },
        requestMeta(req)
      );
      return successResponse(res, coupon, 201);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      const coupon = await CouponService.update(
        req.user,
        String(req.params.code),
        bodyToInput(req.body),
        requestMeta(req)
      );
      return successResponse(res, coupon, 200);
    } catch (error) {
      next(error);
    }
  }

  static async setStatus(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      const coupon = await CouponService.setActive(
        req.user,
        String(req.params.code),
        {
          isActive: Boolean(req.body.is_active),
          reason: String(req.body.reason ?? ''),
          password: req.body.password,
        },
        requestMeta(req)
      );
      return successResponse(res, coupon, 200);
    } catch (error) {
      next(error);
    }
  }
}