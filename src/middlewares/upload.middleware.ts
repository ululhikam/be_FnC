import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { errorResponse } from '../utils/response.util.js';

// 50MB max file size (OpenAPI spec constraint)
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const storage = multer.memoryStorage();

const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Tipe file tidak didukung. Hanya gambar dan video yang diperbolehkan.'));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});

export const uploadSingleMedia = (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err: any) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return errorResponse(res, 'File terlalu besar. Maksimal 50MB per file.', 413, 'FILE_TOO_LARGE');
      }
      return errorResponse(res, `Upload error: ${err.message}`, 400, 'UPLOAD_ERROR');
    } else if (err) {
      return errorResponse(res, err.message, 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    next();
  });
};
