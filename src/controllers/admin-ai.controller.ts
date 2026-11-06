import { Request, Response, NextFunction } from 'express';
import { AdminAiService } from '../services/admin-ai.service.js';
import { errorResponse, successResponse } from '../utils/response.util.js';

function requestMeta(req: Request) {
  return {
    ipAddress: req.ip || req.socket.remoteAddress || null,
    userAgent: req.get('user-agent') || null,
  };
}

/**
 * Asisten AI konsol Super Admin.
 *
 * Hanya menghasilkan saran: tidak ada endpoint di sini yang menulis data
 * bisnis. Penyimpanan tetap lewat endpoint aslinya (re-auth + alasan).
 */
export class AdminAiController {
  static async assist(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Bukan admin', 403, 'FORBIDDEN');
      }

      const result = await AdminAiService.suggest(
        req.user.id,
        {
          context: req.body.context ?? null,
          message: req.body.message ?? null,
          fields: (req.body.fields ?? []).map((field: any) => ({
            name: field.name,
            label: field.label,
            type: field.type ?? 'text',
            currentValue: field.current_value ?? '',
            options: field.options ?? [],
            hint: field.hint ?? '',
          })),
        },
        requestMeta(req)
      );

      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }
}