import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import { InstagramService } from '../services/instagram.service.js';
import { successResponse, errorResponse } from '../utils/response.util.js';
import { generateToken } from '../utils/jwt.util.js';

export class AuthController {
  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { identifier, password, role } = req.body;
      const result = await AuthService.login(identifier, password, role);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async loginGoogle(req: Request, res: Response, next: NextFunction) {
    try {
      const { id_token, role } = req.body;
      const result = await AuthService.loginGoogle(id_token, role);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async registerUser(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await AuthService.registerUser(req.body);
      return successResponse(res, result, 201);
    } catch (error) {
      next(error);
    }
  }

  static async registerBase(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await AuthService.registerBase(req.body);
      return successResponse(res, result, 201);
    } catch (error) {
      next(error);
    }
  }

  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      return successResponse(res, { ok: true, message: 'Logout berhasil' }, 200);
    } catch (error) {
      next(error);
    }
  }

  /** Langkah 1: minta kode OTP reset kata sandi via email. */
  static async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { email } = req.body;
      const result = await AuthService.forgotPassword(email);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /** Langkah 2: verifikasi kode OTP → terima token reset sekali pakai. */
  static async verifyResetOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, otp } = req.body;
      const result = await AuthService.verifyResetOtp(email, otp);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /** Langkah 3: simpan kata sandi baru memakai token reset. */
  static async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, reset_token, password } = req.body;
      const result = await AuthService.resetPassword(email, reset_token, password);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /** Verifikasi OTP email; sekaligus menerbitkan sesi akses. */
  static async verifyEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const { ticket, otp } = req.body;
      const result = await AuthService.verifyEmail(ticket, otp);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /** Kirim ulang OTP verifikasi email. */
  static async resendEmailVerification(req: Request, res: Response, next: NextFunction) {
    try {
      const { ticket } = req.body;
      const result = await AuthService.resendEmailVerification(ticket);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /** Ganti email sebelum email akun terverifikasi. */
  static async changeVerificationEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const { ticket, new_email } = req.body;
      const result = await AuthService.changeVerificationEmail(ticket, new_email);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Unauthenticated', 401, 'UNAUTHORIZED');
      }
      const user = await AuthService.getMe(req.user.id);
      return successResponse(res, { user }, 200);
    } catch (error) {
      next(error);
    }
  }

  static async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Unauthenticated', 401, 'UNAUTHORIZED');
      }
      const token = generateToken({
        sub: req.user.id,
        role: req.user.role,
        handle: req.user.handle,
        email: req.user.email || undefined,
      });
      return successResponse(res, { token }, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Instagram verification via Meta for Developers App
   */
  static async verifyInstagram(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Autentikasi dibutuhkan untuk verifikasi akun Instagram', 401, 'UNAUTHORIZED');
      }
      const result = await InstagramService.verifyAndLinkAccount(req.user.id, req.body);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }
}
