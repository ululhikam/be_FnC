import { Request, Response, NextFunction } from 'express';
import { errorResponse } from '../utils/response.util.js';
import { ENV } from '../config/env.js';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.status || err.statusCode || 500;
  const message = err.message || 'Terjadi kesalahan pada server';
  const code = err.code || 'INTERNAL_SERVER_ERROR';

  if (ENV.NODE_ENV === 'development') {
    console.error('API Error:', err);
  }

  return errorResponse(res, message, statusCode, code, err.errors);
}

export function notFoundHandler(req: Request, res: Response) {
  return errorResponse(
    res,
    `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan`,
    404,
    'NOT_FOUND'
  );
}
