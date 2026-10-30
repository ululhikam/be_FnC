import { Request, Response, NextFunction } from 'express';
import { errorResponse } from '../utils/response.util.js';
import { ENV } from '../config/env.js';

/**
 * Error dari body-parser (`express.json()` / `express.urlencoded()`).
 *
 * Body-parser tidak mengisi `err.code`, sehingga sebelumnya JSON rusak keluar
 * sebagai `400` dengan `code: INTERNAL_SERVER_ERROR` plus pesan parser mentah
 * ("Expected property name ... at position 1"). Kode yang menyesatkan itu
 * membuat monitoring menghitung kesalahan klien sebagai server error, dan
 * pesan parser membocorkan detail internal.
 */
function bodyParserMessage(err: any): { message: string; status: number; code: string } | null {
  if (!err || typeof err !== 'object') return null;

  if (
    err.type === 'entity.parse.failed' ||
    (err instanceof SyntaxError && (err as any).status === 400)
  ) {
    return { message: 'Body JSON tidak valid', status: 400, code: 'BAD_REQUEST' };
  }

  if (err.type === 'entity.too.large') {
    return { message: 'Body permintaan terlalu besar', status: 413, code: 'PAYLOAD_TOO_LARGE' };
  }

  if (err.type === 'charset.unsupported') {
    return { message: 'Charset tidak didukung', status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' };
  }

  return null;
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    return next(err);
  }

  const bodyParserError = bodyParserMessage(err);
  if (bodyParserError) {
    if (ENV.NODE_ENV !== 'test') {
      console.warn(`API Error (${req.method} ${req.path}):`, err.message);
    }
    return errorResponse(
      res,
      bodyParserError.message,
      bodyParserError.status,
      bodyParserError.code
    );
  }

  const statusCode = err.status || err.statusCode || 500;
  const isServerError = statusCode >= 500;
  // Detail internal (pesan Prisma, nama kolom, constraint) tidak boleh keluar
  // ke klien pada 5xx; simpan di log, kirim pesan generik.
  const message =
    isServerError && ENV.NODE_ENV === 'production'
      ? 'Terjadi kesalahan pada server'
      : err.message || 'Terjadi kesalahan pada server';
  const code = err.code || 'INTERNAL_SERVER_ERROR';

  if (ENV.NODE_ENV !== 'test') {
    console.error('API Error:', err);
  }

  return errorResponse(res, message, statusCode, code, err.errors);
}

/**
 * Pesan sengaja tetap: `req.originalUrl` memuat query string yang dikendalikan
 * klien, sehingga merefleksikannya mengotori log/analytics, memudahkan
 * enumerasi endpoint, dan bisa mencatat data sensitif (token/email di URL).
 */
export function notFoundHandler(req: Request, res: Response) {
  return errorResponse(res, 'Endpoint tidak ditemukan', 404, 'NOT_FOUND');
}