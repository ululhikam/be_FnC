import { Response } from 'express';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export function paginatedResponse<T>(
  res: Response,
  data: T[],
  total: number,
  page: number,
  limit: number,
  statusCode = 200
) {
  const total_pages = Math.ceil(total / limit) || 1;
  return res.status(statusCode).json({
    data,
    total,
    page,
    limit,
    total_pages,
  });
}

export function successResponse(res: Response, data?: any, statusCode = 200) {
  if (data !== undefined && data !== null) {
    return res.status(statusCode).json(data);
  }
  return res.status(statusCode).json({ ok: true });
}

export function errorResponse(
  res: Response,
  message: string,
  statusCode = 400,
  code = 'ERROR',
  errors?: Record<string, string>
) {
  return res.status(statusCode).json({
    message,
    code,
    ...(errors ? { errors } : {}),
  });
}
