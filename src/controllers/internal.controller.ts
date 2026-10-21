import { Request, Response } from 'express';
import { InstagramService } from '../services/instagram.service.js';
import { trackBackground } from '../utils/background.js';

export class InternalController {
  /**
   * Lanjutkan publikasi Instagram (worker finalize lintas-invocation) —
   * dipanggil oleh worker sendiri dengan payload bertanda tangan HMAC.
   */
  static async finalizeInstagramPost(req: Request, res: Response) {
    const payload = InstagramService.verifyFinalizePayload(String(req.body?.token || ''));
    if (!payload) {
      return res.status(401).json({ ok: false, error: 'INVALID_TOKEN' });
    }

    trackBackground(InstagramService.finalizeInstagramPost(payload));
    return res.status(202).json({ ok: true, fessId: payload.fessId, attempts: payload.attempts });
  }

  /**
   * Retry auto-post gambar (error sementara Meta/network) — dipanggil oleh
   * worker sendiri dengan payload HMAC. Maksimal 3 percobaan total.
   */
  static async retryInstagramPost(req: Request, res: Response) {
    const payload = InstagramService.verifyRetryPayload(String(req.body?.token || ''));
    if (!payload) {
      return res.status(401).json({ ok: false, error: 'INVALID_TOKEN' });
    }

    trackBackground(InstagramService.retryInstagramPost(payload));
    return res.status(202).json({ ok: true, fessId: payload.fessId, attempt: payload.attempt });
  }
}
