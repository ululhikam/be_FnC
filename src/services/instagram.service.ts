import crypto from 'crypto';
import axios from 'axios';
import { ENV } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import {
  assertCarouselGeometry,
  ensureIgImageUrl,
  IG_CAROUSEL_TARGET,
} from '../utils/instagram-media.util.js';

const API_VERSION = ENV.INSTAGRAM_API_VERSION || 'v25.0';
const API_BASE = `https://graph.instagram.com/${API_VERSION}`;
const FINALIZE_MAX_ATTEMPTS = 6;
/** Total percobaan auto-post (termasuk percobaan pertama) untuk error sementara. */
const AUTO_RETRY_MAX_ATTEMPTS = 3;
const IG_STATUS_MAX_ERROR_LENGTH = 1200;
/** Masa berlaku long-lived token Meta (60 hari) — dipakai bila Meta tidak mengirim expires_in. */
const LONG_LIVED_TTL_SECONDS = 60 * 24 * 60 * 60;

export interface InstagramProfileData {
  id: string;
  username: string;
  accountType?: string;
  mediaCount?: number;
  verified: boolean;
}

/** Satu item media yang akan diposting ke Instagram (card atau media user). */
export interface PostMediaItem {
  type: 'image' | 'video';
  url: string;
  /** Dimensi hasil normalisasi 4:5 (wajib untuk carousel). */
  width?: number;
  height?: number;
  /** Durasi video (detik) — batas carousel Instagram 60 detik. */
  duration?: number | null;
  /** true jika item sudah dinormalisasi backend (mis. card canvas). */
  normalized?: boolean;
}

export interface AutoPostOptions {
  /** Jumlah retry yang sudah dilakukan (0 = percobaan pertama). */
  attempt?: number;
  /** false = jangan jadwalkan retry otomatis (mis. dari retry worker). */
  allowRetry?: boolean;
}

/** Payload retry auto-post gambar (ditandatangani HMAC). */
export interface RetryPayload {
  fessId: string;
  baseHandle: string;
  /** Percobaan berikutnya (1..AUTO_RETRY_MAX_ATTEMPTS-1). */
  attempt: number;
  /** Jeda sebelum retry agar error sementara Meta/network punya waktu pulih. */
  delayMs?: number;
  exp: number;
}

/**
 * Payload worker finalize (ditandatangani HMAC) — dipakai untuk melanjutkan
 * publikasi lintas invocation karena video butuh > 60 detik diproses Meta.
 */
export interface FinalizePayload {
  fessId: string;
  baseHandle: string;
  kind: 'carousel' | 'reels';
  /** Child container (fase 1: tunggu item → rakit carousel). */
  itemIds: string[] | null;
  /** Container siap-publish (carousel/Reels) — fase 2: tunggu → publish. */
  containerId: string | null;
  attempts: number;
  /** Epoch ms — payload kedaluwarsa setelah ini. */
  exp: number;
}

export class InstagramService {
  /**
   * Generate Meta Instagram OAuth authorization URL
   */
  static getAuthorizationUrl(state?: string): string {
    const params = new URLSearchParams({
      enable_fb_login: '0',
      force_authentication: '1',
      client_id: ENV.INSTAGRAM_CLIENT_ID,
      redirect_uri: ENV.INSTAGRAM_REDIRECT_URI,
      response_type: 'code',
      scope: ENV.INSTAGRAM_SCOPES,
    });

    if (state) {
      params.set('state', state);
    }

    return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
  }

  /**
   * Verify an Instagram account token with Meta Graph API
   */
  static async verifyToken(accessToken: string): Promise<InstagramProfileData> {
    try {
      // Call Meta Instagram Basic Display or Graph API
      const response = await axios.get(`${API_BASE}/me`, {
        params: {
          fields: 'id,username,account_type,media_count',
          access_token: accessToken,
        },
        timeout: 6000,
      });

      return {
        id: response.data.id,
        username: response.data.username ? `@${response.data.username.replace(/^@/, '')}` : '@instagram_user',
        accountType: response.data.account_type || 'BUSINESS',
        mediaCount: response.data.media_count || 0,
        verified: true,
      };
    } catch (error: any) {
      // If offline, dummy token, or Meta API error in test/dev:
      if (ENV.NODE_ENV !== 'production' || accessToken.startsWith('mock_')) {
        return {
          id: 'meta_ig_' + Date.now(),
          username: '@codememfess_ig',
          accountType: 'BUSINESS',
          mediaCount: 128,
          verified: true,
        };
      }
      throw new Error(`Verifikasi akun Instagram via Meta Graph API gagal: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Exchange Meta OAuth authorization code for an Instagram access token
   */
  static async exchangeCodeForToken(code: string): Promise<string> {
    const cleanCode = (code || '').split('#')[0].trim();
    try {
      const params = new URLSearchParams();
      params.append('client_id', ENV.INSTAGRAM_CLIENT_ID);
      params.append('client_secret', ENV.INSTAGRAM_CLIENT_SECRET);
      params.append('grant_type', 'authorization_code');
      params.append('redirect_uri', ENV.INSTAGRAM_REDIRECT_URI);
      params.append('code', cleanCode);

      const response = await axios.post('https://api.instagram.com/oauth/access_token', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 8000,
      });

      return response.data.access_token;
    } catch (error: any) {
      if (ENV.NODE_ENV !== 'production') {
        return 'mock_meta_ig_token_' + Date.now();
      }
      throw new Error(`Gagal menukarkan kode OAuth Meta: ${error.response?.data?.error_message || error.message}`);
    }
  }

  /**
   * Exchange short-lived token to 60-day long-lived token.
   * Mengembalikan token + masa berlaku (detik) agar job refresh bisa
   * memperpanjang sebelum kedaluwarsa.
   */
  static async getLongLivedToken(
    shortToken: string
  ): Promise<{ accessToken: string; expiresIn: number }> {
    if (shortToken.startsWith('mock_')) {
      return { accessToken: shortToken, expiresIn: LONG_LIVED_TTL_SECONDS };
    }
    try {
      const response = await axios.get('https://graph.instagram.com/access_token', {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: ENV.INSTAGRAM_CLIENT_SECRET,
          access_token: shortToken,
        },
        timeout: 8000,
      });

      const accessToken = response.data.access_token || shortToken;
      const expiresIn = Number(response.data.expires_in) || LONG_LIVED_TTL_SECONDS;
      return { accessToken, expiresIn };
    } catch {
      // Perilaku lama: token pendek tetap dikembalikan. Expiry 1 jam agar job
      // refresh mencoba memperbaikinya (bukan diam-diam mati setelah 60 hari).
      return { accessToken: shortToken, expiresIn: 3600 };
    }
  }

  /**
   * Perpanjang long-lived token 60 hari lagi (syarat Meta: token ≥24 jam &
   * belum kedaluwarsa). Error dilempar apa adanya — pemanggil (job) mencatat.
   */
  static async refreshLongLivedToken(
    token: string
  ): Promise<{ accessToken: string; expiresIn: number }> {
    if (token.startsWith('mock_')) {
      return { accessToken: token, expiresIn: LONG_LIVED_TTL_SECONDS };
    }
    const response = await axios.get('https://graph.instagram.com/refresh_access_token', {
      params: {
        grant_type: 'ig_refresh_token',
        access_token: token,
      },
      timeout: 8000,
    });

    const accessToken = response.data?.access_token || token;
    const expiresIn = Number(response.data?.expires_in) || LONG_LIVED_TTL_SECONDS;
    return { accessToken, expiresIn };
  }

  /**
   * Kuota publikasi Meta Content Publishing: maksimum 100 post per 24 jam per
   * akun. Best-effort — bila endpoint gagal/tidak tersedia, kembalikan null
   * supaya publikasi tetap dicoba (tidak memblokir fitur yang sudah jalan).
   */
  static async getPublishingQuota(
    token: string
  ): Promise<{ usage: number; total: number } | null> {
    try {
      const res = await axios.get(`${API_BASE}/me/content_publishing_limit`, {
        params: { fields: 'quota_usage,config', access_token: token },
        timeout: 8000,
      });
      const entry = Array.isArray(res.data?.data) ? res.data.data[0] : null;
      if (!entry) return null;
      const usage = Number(entry.quota_usage);
      const total = Number(entry.config?.quota_total) || 100;
      if (!Number.isFinite(usage)) return null;
      return { usage, total };
    } catch {
      return null;
    }
  }

  /**
   * Verify Instagram account by handle or token and update connection in database
   */
  static async verifyAndLinkAccount(
    userId: string,
    data: { token?: string; code?: string; handle?: string; baseHandle?: string }
  ) {
    let profile: InstagramProfileData;
    let savedToken: string | undefined = data.token;
    let tokenExpiresAt: string | null = null;

    if (data.token) {
      profile = await this.verifyToken(data.token);
    } else if (data.code) {
      const shortToken = await this.exchangeCodeForToken(data.code);
      const longToken = await this.getLongLivedToken(shortToken);
      savedToken = longToken.accessToken;
      tokenExpiresAt = new Date(Date.now() + longToken.expiresIn * 1000).toISOString();
      profile = await this.verifyToken(longToken.accessToken);
    } else if (data.handle) {
      // Verify handle format and create verified record
      const cleanHandle = data.handle.startsWith('@') ? data.handle : `@${data.handle}`;
      profile = {
        id: 'ig_' + Buffer.from(cleanHandle).toString('hex').slice(0, 12),
        username: cleanHandle,
        accountType: 'COMMUNITY',
        mediaCount: 42,
        verified: true,
      };
    } else {
      throw new Error('Diperlukan token, OAuth code, atau username Instagram untuk verifikasi');
    }

    // Unlink old user if this instagramId was previously linked to another user
    if (profile.id) {
      await prisma.user.updateMany({
        where: {
          instagramId: profile.id,
          id: { not: userId },
        },
        data: {
          instagramId: null,
          igAccount: null,
        },
      });
    }

    // Update user profile with verified Instagram account
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        igAccount: profile.username,
        instagramId: profile.id,
      },
    });

    // Metadata koneksi: expiry token + identitas akun IG (dipakai untuk
    // auto-refresh token & pencocokan Deauthorize Callback Meta).
    const connectionMetadata: Record<string, string> = {};
    if (tokenExpiresAt) connectionMetadata.tokenExpiresAt = tokenExpiresAt;
    if (profile.id) connectionMetadata.igUserId = String(profile.id);
    if (profile.username) connectionMetadata.igUsername = String(profile.username);
    const hasMetadata = Object.keys(connectionMetadata).length > 0;

    // Upsert PlatformConnection for Instagram
    await prisma.platformConnection.upsert({
      where: {
        userId_platform: {
          userId,
          platform: 'instagram',
        },
      },
      create: {
        userId,
        platform: 'instagram',
        name: 'Instagram Graph API (Auto-Post Feed & Reels)',
        status: 'connected',
        connected: true,
        accountHandle: profile.username,
        accessToken: savedToken || null,
        ...(hasMetadata ? { metadata: connectionMetadata } : {}),
      },
      update: {
        status: 'connected',
        connected: true,
        accountHandle: profile.username,
        ...(savedToken ? { accessToken: savedToken } : {}),
        ...(hasMetadata ? { metadata: connectionMetadata } : {}),
      },
    });

    // If base handle is provided, link Instagram handle to Base profile
    if (data.baseHandle) {
      await prisma.base.updateMany({
        where: { handle: data.baseHandle },
        data: { igAccount: profile.username },
      });
    }

    // Record system log
    await prisma.systemLog.create({
      data: {
        source: 'AUTO_BASE',
        message: `Akun Instagram ${profile.username} berhasil diverifikasi & dikoneksikan via Meta for Developers App.`,
        tone: 'ok',
      },
    });

    return {
      verified: true,
      profile,
      user,
    };
  }

  /**
   * Auto-post fess ke Instagram Feed via Meta Content Publishing API.
   * Menerima 1 media (post tunggal / Reels) atau 2–10 media gambar+video
   * (carousel) — item berupa string dianggap gambar.
   */
  static async autoPostFess(
    baseHandle: string,
    fessId: string,
    media: PostMediaItem | PostMediaItem[] | string | string[],
    caption: string,
    options: AutoPostOptions = {}
  ) {
    const attempt = Math.max(0, Math.floor(Number(options.attempt) || 0));
    const allowRetry = options.allowRetry !== false;

    // Normalisasi daftar media: buang data-URI (Meta butuh URL publik) &
    // batasi 10 item (maksimum carousel Instagram).
    let items: PostMediaItem[] = (Array.isArray(media) ? media : [media])
      .map((m) => (typeof m === 'string' ? { type: 'image' as const, url: m } : m))
      .filter(
        (m): m is PostMediaItem =>
          !!m && typeof m.url === 'string' && m.url.length > 0 && !m.url.startsWith('data:')
      )
      .slice(0, 10);

    let isCarousel = items.length > 1;
    let baseIg = baseHandle;
    let mediaLabel = isCarousel
      ? `carousel ${items.length} media`
      : items[0]?.type === 'video'
        ? 'video Reels'
        : 'visual Feed card';

    try {
      await InstagramService.updateFessIgState(fessId, {
        igStatus: 'processing',
        igError: null,
        igAttempts: attempt + 1,
      });

      // Resolve koneksi Instagram kreator base (token nyata saja)
      const connection = await InstagramService.resolveInstagramConnection(baseHandle);
      baseIg = connection.baseIg;
      const token = connection.token;

      if (!token) {
        const detail = `Akun Instagram ${baseIg} belum terhubung ke Meta. Hubungkan akun melalui menu Koneksi Platform.`;
        await InstagramService.updateFessIgState(fessId, {
          igStatus: 'failed',
          igError: InstagramService.truncateIgError(detail),
        });
        await InstagramService.writeAudit(
          `Fess #${fessId} tidak dipublikasikan ke ${baseIg} (${mediaLabel}): ${detail}`,
          'error'
        );
        return {
          success: true,
          platform: 'instagram',
          meta_published: false,
          ig_pending: false,
          imageUrl: items[0]?.url || null,
          imageUrls: items.map((item) => item.url),
          items,
          is_carousel: isCarousel,
          fessId,
          base_ig: baseIg,
          error: detail,
          message: `Card fess #${fessId} berhasil di-render, tetapi Instagram ${baseIg} belum terhubung.`,
        };
      }

      if (!items.length) {
        const detail = 'Tidak ada media publik yang bisa diposting ke Instagram.';
        await InstagramService.updateFessIgState(fessId, {
          igStatus: 'failed',
          igError: detail,
        });
        await InstagramService.writeAudit(
          `Auto-post fess #${fessId} gagal: ${detail}`,
          'error'
        );
        return {
          success: false,
          platform: 'instagram',
          meta_published: false,
          ig_pending: false,
          fessId,
          base_ig: baseIg,
          error: detail,
        };
      }

      // Guard kuota Meta: maksimum 100 publikasi per 24 jam per akun.
      // Best-effort — kegagalan cek kuota tidak menghalangi publikasi.
      const quota = await InstagramService.getPublishingQuota(token);
      if (quota && quota.usage >= quota.total) {
        const detail = `Kuota publikasi Instagram ${baseIg} penuh (${quota.usage}/${quota.total} per 24 jam). Coba lagi setelah kuota direset Meta.`;
        await InstagramService.updateFessIgState(fessId, {
          igStatus: 'failed',
          igError: InstagramService.truncateIgError(detail),
        });
        await InstagramService.writeAudit(
          `Fess #${fessId} tidak dipublikasikan — ${detail}`,
          'error'
        );
        return {
          success: false,
          platform: 'instagram',
          meta_published: false,
          ig_pending: false,
          fessId,
          base_ig: baseIg,
          error: detail,
        };
      }

      // Semua item carousel wajib 1080×1350 (4:5). Gambar dinormalisasi di
      // sini; video harus sudah dinormalisasi oleh klien/komposer.
      try {
        items = await InstagramService.prepareCarouselItems(items);
      } catch (prepareErr: any) {
        const detail = prepareErr?.message || 'Media carousel tidak valid.';
        // Error unduhan/upload sementara tetap layak retry; error format,
        // dimensi, atau durasi akan langsung ditandai gagal oleh classifier.
        return await InstagramService.completeAutoPostFailure({
          fessId,
          baseHandle,
          baseIg,
          mediaLabel,
          detail,
          err: prepareErr,
          attempt,
          allowRetry,
          items,
          caption,
          isCarousel,
        });
      }

      isCarousel = items.length > 1;
      mediaLabel = isCarousel
        ? `carousel ${items.length} media`
        : items[0]?.type === 'video'
          ? 'video Reels'
          : 'visual Feed card';
      const captionText = InstagramService.buildCaption(caption, baseHandle);

      // Simpan payload final agar retry tidak perlu mengunduh/menormalkan
      // ulang dari data mentah dan agar admin bisa melihat apa yang dikirim.
      await InstagramService.updateFessIgState(fessId, {
        igPayload: {
          baseHandle,
          caption,
          aspect: 'portrait',
          width: IG_CAROUSEL_TARGET.width,
          height: IG_CAROUSEL_TARGET.height,
          items: items.map((item) => ({
            type: item.type,
            url: item.url,
            width: item.width,
            height: item.height,
            duration: item.duration ?? null,
            normalized: true,
          })),
          updatedAt: new Date().toISOString(),
        },
      });

      let metaPublished = false;
      let igPending = false;
      let postCreationId: string | null = null;
      let failureDetail = '';
      let failureErr: any = null;

      try {
        const hasVideo = items.some((item) => item.type === 'video');

        if (hasVideo) {
          // Video butuh ~25 dtk diproses Meta + ~25 dtk lagi untuk container
          // carousel — tidak muat dalam batas 60 dtk Vercel. Container dibuat
          // di sini, tunggu + publish diserahkan ke worker finalize internal.
          if (isCarousel) {
            // Item video dibuat lebih dulu agar Meta mulai memprosesnya lebih
            // awal; urutan id tetap mengikuti urutan tampil media.
            const createdIds = new Map<number, string>();
            const creationOrder = items
              .map((item, idx) => ({ item, idx }))
              .sort((a, b) => (a.item.type === 'video' ? 0 : 1) - (b.item.type === 'video' ? 0 : 1));
            for (const { item, idx } of creationOrder) {
              createdIds.set(idx, await InstagramService.createItemContainer(item, token));
            }
            const itemIds = items.map((_, idx) => createdIds.get(idx)!);

            await InstagramService.scheduleFinalize({
              fessId,
              baseHandle,
              kind: 'carousel',
              itemIds,
              containerId: null,
              attempts: 0,
              exp: Date.now() + 30 * 60_000,
            });
          } else {
            // Video tunggal → Reels (caption menempel di container).
            const containerId = await InstagramService.createVideoContainer(items[0].url, captionText, token);
            await InstagramService.scheduleFinalize({
              fessId,
              baseHandle,
              kind: 'reels',
              itemIds: null,
              containerId,
              attempts: 0,
              exp: Date.now() + 30 * 60_000,
            });
          }
          igPending = true;
        } else if (isCarousel) {
          // Semua gambar → alur sinkron (cepat): item → tunggu → carousel → tunggu → publish.
          const itemIds: string[] = [];
          for (const item of items) {
            itemIds.push(await InstagramService.createItemContainer(item, token));
          }
          const itemsReady = await InstagramService.waitForContainersFinished(itemIds, token);
          if (!itemsReady) throw new Error('Container item Meta belum siap (masih IN_PROGRESS) setelah 30 detik.');

          postCreationId = await InstagramService.createCarouselContainer(captionText, itemIds, token);
        } else {
          // Gambar tunggal → Feed card biasa.
          postCreationId = await InstagramService.createImageContainer(items[0].url, captionText, token);
        }

        if (!igPending && postCreationId) {
          // Tunggu Meta selesai memproses container (status FINISHED) sebelum publish.
          // Publish saat container masih IN_PROGRESS selalu gagal: "Media ID is not available".
          const containerReady = await InstagramService.waitForContainersFinished([postCreationId], token);
          if (!containerReady) throw new Error('Container media Meta belum siap (masih IN_PROGRESS) setelah 30 detik.');

          const pubRes = await InstagramService.publishContainerWithRetry(
            postCreationId,
            token
          );
          if (pubRes.data?.id) {
            metaPublished = true;
          }
        }
      } catch (apiErr: any) {
        failureErr = apiErr;
        failureDetail = InstagramService.metaErrorDetail(apiErr);
        console.warn('[Instagram AutoPost] Meta API warning:', failureDetail);
      }

      if (failureDetail && !igPending) {
        return await InstagramService.completeAutoPostFailure({
          fessId,
          baseHandle,
          baseIg,
          mediaLabel,
          detail: failureDetail,
          err: failureErr,
          attempt,
          allowRetry,
          items,
          caption,
          isCarousel,
        });
      }

      if (igPending) {
        await InstagramService.updateFessIgState(fessId, {
          igStatus: 'pending',
          igError: null,
        });
        await InstagramService.writeAudit(
          `Fess #${fessId}: video sedang diproses Meta — publikasi otomatis ke ${baseIg} sedang berjalan (${mediaLabel}).`,
          'ok'
        );
        return {
          success: true,
          platform: 'instagram',
          meta_published: false,
          ig_pending: true,
          creation_id: postCreationId,
          imageUrl: items[0]?.url || null,
          imageUrls: items.map((item) => item.url),
          items,
          is_carousel: isCarousel,
          fessId,
          base_ig: baseIg,
          message: `Video sedang diproses Instagram — fess #${fessId} akan terbit otomatis ke ${baseIg} dalam ±1 menit.`,
        };
      }

      if (metaPublished) {
        await InstagramService.updateFessIgState(fessId, {
          igStatus: 'published',
          igError: null,
          postedToIg: true,
        });
        await InstagramService.writeAudit(
          `Fess #${fessId} berhasil dipublikasikan ke Instagram Feed ${baseIg} (${mediaLabel}, percobaan ${attempt + 1}/${AUTO_RETRY_MAX_ATTEMPTS}).`,
          'ok'
        );
        return {
          success: true,
          platform: 'instagram',
          meta_published: true,
          ig_pending: false,
          creation_id: postCreationId,
          imageUrl: items[0]?.url || null,
          imageUrls: items.map((item) => item.url),
          items,
          is_carousel: isCarousel,
          fessId,
          base_ig: baseIg,
          message: `Card fess #${fessId} berhasil diposting otomatis ke Instagram Feed ${baseIg}${isCarousel ? ` (carousel ${items.length} media)` : ''}!`,
        };
      }

      return await InstagramService.completeAutoPostFailure({
        fessId,
        baseHandle,
        baseIg,
        mediaLabel,
        detail: 'Meta tidak mengembalikan id media setelah proses publikasi.',
        err: null,
        attempt,
        allowRetry,
        items,
        caption,
        isCarousel,
      });
    } catch (err: any) {
      console.error('[Instagram AutoPost Error]', err.message);

      await InstagramService.updateFessIgState(fessId, {
        igStatus: 'failed',
        igError: InstagramService.truncateIgError(
          err?.message || 'Kesalahan auto-post Instagram tidak diketahui'
        ),
      });
      await InstagramService.writeAudit(
        `Auto-post fess #${fessId} gagal ke ${baseHandle}: ${err.message || 'Kesalahan tidak diketahui'}`,
        'error'
      );

      return {
        success: false,
        platform: 'instagram',
        error: err.message,
        items,
        imageUrls: items.map((item) => item.url),
        is_carousel: isCarousel,
        fessId,
        base_ig: baseIg,
      };
    }
  }

  /** Normalisasi gambar & validasi geometri semua item carousel. */
  private static async prepareCarouselItems(items: PostMediaItem[]): Promise<PostMediaItem[]> {
    const prepared: PostMediaItem[] = [];

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item.type === 'video') {
        const duration = Number(item.duration);
        if (Number.isFinite(duration) && duration > 60.5) {
          throw new Error(
            `Video carousel #${index + 1} berdurasi ${Math.round(duration)} detik; ` +
              'Instagram carousel membatasi video maksimal 60 detik. Kompres/potong video terlebih dahulu.'
          );
        }
        if (!item.width || !item.height) {
          throw new Error(
            `Video carousel #${index + 1} belum memiliki metadata dimensi. ` +
              'Video harus dinormalisasi ke 1080×1350 (4:5) di komposer sebelum diposting.'
          );
        }
        prepared.push({
          ...item,
          width: Number(item.width),
          height: Number(item.height),
          normalized: true,
        });
        continue;
      }

      if (
        item.normalized &&
        Number(item.width) === IG_CAROUSEL_TARGET.width &&
        Number(item.height) === IG_CAROUSEL_TARGET.height
      ) {
        prepared.push({
          ...item,
          width: IG_CAROUSEL_TARGET.width,
          height: IG_CAROUSEL_TARGET.height,
        });
        continue;
      }

      const normalized = await ensureIgImageUrl(item.url, IG_CAROUSEL_TARGET);
      prepared.push({
        ...item,
        url: normalized.url,
        width: normalized.width,
        height: normalized.height,
        normalized: true,
      });
    }

    assertCarouselGeometry(prepared, IG_CAROUSEL_TARGET);
    return prepared;
  }

  /** Klasifikasi error Meta: hanya error sementara yang layak di-retry. */
  private static isRetryableIgError(err: any, detail: string): boolean {
    const code = Number(err?.response?.data?.error?.code);
    if (code === 190) return false; // token kedaluwarsa/dicabut — perlu OAuth ulang
    if ([1, 2, 4, 17, 32, 613, 9004, 9007].includes(code)) return true;

    // Error permanen harus dicek SEBELUM "tanpa response", karena error
    // normalisasi/format lokal juga tidak memiliki response HTTP.
    if (
      /rasio|ratio|format|dimension|dimensi|metadata|ukuran|durasi|duration|unsupported|invalid|tidak valid|harus berupa http/i.test(
        detail
      )
    ) {
      return false;
    }
    if (!err?.response || err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') return true;
    if (
      /timeout|network|fetch|temporar|rate limit|try again|not available|not ready|media is not ready|belum siap|unduh|upload|unggah|storage/i.test(
        detail
      )
    ) {
      return true;
    }
    return false;
  }

  /** Akhiri auto-post: jadwalkan retry bila memungkinkan, atau tandai gagal. */
  private static async completeAutoPostFailure(args: {
    fessId: string;
    baseHandle: string;
    baseIg: string;
    mediaLabel: string;
    detail: string;
    err: any;
    attempt: number;
    allowRetry: boolean;
    items: PostMediaItem[];
    caption: string;
    isCarousel: boolean;
  }) {
    const {
      fessId,
      baseHandle,
      baseIg,
      mediaLabel,
      detail,
      err,
      attempt,
      allowRetry,
      items,
      caption,
      isCarousel,
    } = args;

    const retryable = InstagramService.isRetryableIgError(err, detail);
    const canRetry = retryable && allowRetry && attempt + 1 < AUTO_RETRY_MAX_ATTEMPTS;

    if (canRetry) {
      const retryNote = `Percobaan ${attempt + 1}/${AUTO_RETRY_MAX_ATTEMPTS} gagal: ${detail}. Retry otomatis dijadwalkan.`;
      // Simpan status SEBELUM memanggil worker retry. Worker bisa selesai lebih
      // dulu; kalau status ditulis setelahnya, hasil "published" akan tertimpa.
      await InstagramService.updateFessIgState(fessId, {
        igStatus: 'processing',
        igError: InstagramService.truncateIgError(retryNote),
      });

      try {
        await InstagramService.scheduleRetry({
          fessId,
          baseHandle,
          attempt: attempt + 1,
          delayMs: attempt === 0 ? 5_000 : 10_000,
          exp: Date.now() + 30 * 60_000,
        });
        await InstagramService.writeAudit(
          `Fess #${fessId} gagal dipublikasikan ke ${baseIg} (${mediaLabel}) — ${retryNote}`,
          'error'
        );
        return {
          success: false,
          platform: 'instagram',
          meta_published: false,
          ig_pending: false,
          retry_scheduled: true,
          imageUrl: items[0]?.url || null,
          imageUrls: items.map((item) => item.url),
          items,
          is_carousel: isCarousel,
          fessId,
          base_ig: baseIg,
          error: detail,
          message: `Publikasi Instagram gagal sementara. Sistem mencoba lagi otomatis (${attempt + 2}/${AUTO_RETRY_MAX_ATTEMPTS}).`,
        };
      } catch (scheduleErr: any) {
        const scheduleDetail = `${detail}. Gagal menjadwalkan retry: ${scheduleErr?.message || scheduleErr}`;
        await InstagramService.updateFessIgState(fessId, {
          igStatus: 'failed',
          igError: InstagramService.truncateIgError(scheduleDetail),
        });
        await InstagramService.writeAudit(
          `Fess #${fessId} GAGAL dipublikasikan ke ${baseIg} (${mediaLabel}): ${scheduleDetail}`,
          'error'
        );
        return {
          success: false,
          platform: 'instagram',
          meta_published: false,
          ig_pending: false,
          imageUrl: items[0]?.url || null,
          imageUrls: items.map((item) => item.url),
          items,
          is_carousel: isCarousel,
          fessId,
          base_ig: baseIg,
          error: scheduleDetail,
          message: `Publikasi Instagram gagal: ${scheduleDetail}`,
        };
      }
    }

    const finalDetail = `${detail}${
      retryable && !allowRetry ? ' (retry otomatis dinonaktifkan)' : ''
    }`;
    await InstagramService.updateFessIgState(fessId, {
      igStatus: 'failed',
      igError: InstagramService.truncateIgError(finalDetail),
    });
    await InstagramService.writeAudit(
      `Fess #${fessId} GAGAL dipublikasikan ke Instagram Feed ${baseIg} (${mediaLabel}) ` +
        `pada percobaan ${attempt + 1}/${AUTO_RETRY_MAX_ATTEMPTS}: ${finalDetail}`,
      'error'
    );
    return {
      success: false,
      platform: 'instagram',
      meta_published: false,
      ig_pending: false,
      imageUrl: items[0]?.url || null,
      imageUrls: items.map((item) => item.url),
      items,
      is_carousel: isCarousel,
      fessId,
      base_ig: baseIg,
      error: finalDetail,
      message: `Publikasi Instagram gagal: ${finalDetail}`,
    };
  }

  /** Update status IG fess dengan aman (prisma.fess bisa tidak ada di unit test). */
  static async updateFessIgState(fessId: string, data: Record<string, any>): Promise<void> {
    try {
      const model: any = (prisma as any).fess;
      if (!model?.update) return;
      await model.update({
        where: { id: fessId },
        data: { ...data, igUpdatedAt: new Date() },
      });
    } catch (err: any) {
      console.warn('[Instagram AutoPost] Gagal memperbarui status IG:', err?.message || err);
    }
  }

  /** Catat audit log tanpa menggagalkan alur utama. */
  private static async writeAudit(message: string, tone: 'ok' | 'error' | 'info'): Promise<void> {
    try {
      await prisma.systemLog.create({ data: { source: 'CANVAS_WORKER', message, tone } });
    } catch {
      // Audit log bersifat best-effort.
    }
  }

  /** Detail error Meta yang ramah dibaca admin. */
  static metaErrorDetail(apiErr: any): string {
    const metaError = apiErr?.response?.data?.error;
    let detail =
      metaError?.error_user_msg ||
      metaError?.message ||
      apiErr?.message ||
      'Kesalahan tidak diketahui';
    if (metaError?.code === 190) {
      detail += ' — token Instagram kedaluwarsa/dicabut, hubungkan ulang akun via Meta OAuth';
    } else if (metaError?.code) {
      detail += ` (kode Meta ${metaError.code})`;
    }
    return detail;
  }

  /** Meta 9007 = container sudah FINISHED tetapi belum siap dipublikasikan. */
  private static isMediaNotReadyError(err: any, detail: string): boolean {
    const code = Number(err?.response?.data?.error?.code);
    return code === 9007 || /media is not ready|not ready for publishing|belum siap/i.test(detail);
  }

  /**
   * Publish container dengan satu percobaan tambahan untuk Meta 9007.
   * Meta kadang butuh beberapa detik ekstra meski status container FINISHED.
   */
  private static async publishContainerWithRetry(
    containerId: string,
    accessToken: string,
    deadlineTs = Date.now() + 20_000
  ): Promise<any> {
    const maxAttempts = 2;
    let lastErr: any;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const waitMs = Math.min(2500, Math.max(0, deadlineTs - Date.now()));
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      try {
        return await axios.post(`${API_BASE}/me/media_publish`, null, {
          params: { creation_id: containerId, access_token: accessToken },
          timeout: 15000,
        });
      } catch (err: any) {
        lastErr = err;
        const detail = InstagramService.metaErrorDetail(err);
        if (!InstagramService.isMediaNotReadyError(err, detail) || attempt === maxAttempts - 1) {
          throw err;
        }
        console.warn(
          `[Instagram Publish] container ${containerId} belum siap, mencoba sekali lagi:`,
          detail
        );
      }
    }

    throw lastErr;
  }

  static truncateIgError(value: string): string {
    const text = String(value || '').trim();
    return text.length > IG_STATUS_MAX_ERROR_LENGTH
      ? `${text.slice(0, IG_STATUS_MAX_ERROR_LENGTH - 1)}…`
      : text;
  }

  /**
   * Cabut seluruh akses Instagram untuk satu IG user id — dipakai oleh
   * Deauthorize Callback & Data Deletion Callback Meta: hapus token koneksi
   * base (token benar-benar dihapus dari server) + lepaskan binding login
   * `instagramId` pada user. Aman dipanggil walau tidak ada data yang cocok.
   */
  static async revokeInstagramAccess(
    igUserId: string,
    reason: string
  ): Promise<{ connections: number; users: number }> {
    if (!igUserId) return { connections: 0, users: 0 };

    let connections = 0;

    const all = await prisma.platformConnection.findMany({
      where: { platform: 'instagram' },
    });
    const matched = all.filter((conn) => {
      const metadata = (conn.metadata || {}) as Record<string, unknown>;
      return String(metadata.igUserId || '') === igUserId;
    });

    for (const conn of matched) {
      const metadata = (conn.metadata || {}) as Record<string, unknown>;
      await prisma.platformConnection.update({
        where: { id: conn.id },
        data: {
          connected: false,
          status: 'revoked',
          accessToken: null,
          metadata: { ...metadata, revokedAt: new Date().toISOString() },
        },
      });
      await prisma.systemLog
        .create({
          data: {
            source: 'CANVAS_WORKER',
            message: `Akses Meta dicabut oleh pengguna Instagram (${reason}) — koneksi ${
              conn.accountHandle || conn.userId
            } diputus otomatis.`,
            tone: 'ok',
          },
        })
        .catch(() => {});
      connections += 1;
    }

    // Lepaskan binding login Instagram pada user (bila ada).
    const unlink = await prisma.user
      .updateMany({
        where: { instagramId: igUserId },
        data: { instagramId: null },
      })
      .catch(() => ({ count: 0 }));

    return { connections, users: unlink?.count || 0 };
  }

  /** Cari koneksi Instagram (token nyata) milik kreator base. */
  private static async resolveInstagramConnection(
    baseHandle: string
  ): Promise<{ baseIg: string; token: string | null }> {
    const base = prisma.base?.findUnique
      ? await prisma.base.findUnique({
          where: { handle: baseHandle },
          include: { creator: true },
        })
      : null;

    const baseIg = base?.igAccount || baseHandle;
    let token: string | null = null;

    if (base?.creatorId && prisma.platformConnection?.findUnique) {
      const connection = await prisma.platformConnection.findUnique({
        where: {
          userId_platform: {
            userId: base.creatorId,
            platform: 'instagram',
          },
        },
      });
      if (connection?.connected && connection.accessToken && !connection.accessToken.startsWith('mock_')) {
        token = connection.accessToken;
      }
    }

    return { baseIg, token };
  }

  /** Buat item container carousel (gambar/video) tanpa caption. */
  private static async createItemContainer(item: PostMediaItem, token: string): Promise<string> {
    const params: Record<string, string> =
      item.type === 'video'
        ? { video_url: item.url, media_type: 'VIDEO', is_carousel_item: 'true' }
        : { image_url: item.url, is_carousel_item: 'true' };
    params.access_token = token;

    const res = await axios.post(`${API_BASE}/me/media`, null, { params, timeout: 15000 });
    const id = res.data?.id;
    if (!id) throw new Error('Gagal membuat carousel item container (tanpa id).');
    return id;
  }

  /** Buat container gambar tunggal (Feed card) dengan caption. */
  private static async createImageContainer(
    imageUrl: string,
    captionText: string,
    token: string
  ): Promise<string> {
    const res = await axios.post(`${API_BASE}/me/media`, null, {
      params: { image_url: imageUrl, caption: captionText, access_token: token },
      timeout: 15000,
    });
    const id = res.data?.id;
    if (!id) throw new Error('Gagal membuat container gambar (tanpa id).');
    return id;
  }

  /** Buat container video tunggal (Reels) dengan caption. */
  private static async createVideoContainer(
    videoUrl: string,
    captionText: string | null,
    token: string
  ): Promise<string> {
    const params: Record<string, string> = {
      media_type: 'REELS',
      video_url: videoUrl,
      access_token: token,
    };
    if (captionText !== null) params.caption = captionText;

    const res = await axios.post(`${API_BASE}/me/media`, null, { params, timeout: 15000 });
    const id = res.data?.id;
    if (!id) throw new Error('Gagal membuat container Reels (tanpa id).');
    return id;
  }

  /** Rakit container carousel dari item container (caption menempel di sini). */
  private static async createCarouselContainer(
    captionText: string,
    itemIds: string[],
    token: string
  ): Promise<string> {
    const res = await axios.post(`${API_BASE}/me/media`, null, {
      params: {
        media_type: 'CAROUSEL',
        children: itemIds.join(','),
        caption: captionText,
        access_token: token,
      },
      timeout: 15000,
    });
    const id = res.data?.id;
    if (!id) throw new Error('Gagal membuat carousel container (tanpa id).');
    return id;
  }

  // ── Worker finalize lintas-invocation (video > 60 dtk budget Vercel) ──────

  private static internalSecret(): string {
    return ENV.INSTAGRAM_CLIENT_SECRET || ENV.JWT_SECRET || 'fessncurious-internal';
  }

  /** Tanda tangani payload worker dengan HMAC-SHA256 (base64url). */
  static signFinalizePayload(payload: FinalizePayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto
      .createHmac('sha256', InstagramService.internalSecret())
      .update(body)
      .digest('base64url');
    return `${body}.${sig}`;
  }

  /** Verifikasi payload worker; null jika tanda tangan/expired tidak valid. */
  static verifyFinalizePayload(token: string): FinalizePayload | null {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;

    const expected = crypto
      .createHmac('sha256', InstagramService.internalSecret())
      .update(body)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as FinalizePayload;
      if (!payload?.fessId || !payload?.baseHandle || !payload.exp || Date.now() > payload.exp) {
        return null;
      }
      if (
        !['carousel', 'reels'].includes(payload.kind) ||
        !Number.isInteger(Number(payload.attempts)) ||
        (payload.kind === 'carousel' &&
          !Array.isArray(payload.itemIds) &&
          typeof payload.containerId !== 'string') ||
        (payload.kind === 'reels' && typeof payload.containerId !== 'string')
      ) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  /** Kirim tugas finalize ke endpoint internal (invocation baru, budget 60 dtk sendiri). */
  private static async scheduleFinalize(payload: FinalizePayload): Promise<void> {
    const token = InstagramService.signFinalizePayload(payload);
    const baseUrl = ENV.BACKEND_PUBLIC_URL.replace(/\/+$/, '');
    await axios.post(`${baseUrl}/internal/instagram/finalize`, { token }, { timeout: 10000 });
  }

  // ── Retry auto-post (error sementara Meta/network) ────────────────────────

  /** Tanda tangani payload retry dengan HMAC yang sama seperti worker finalize. */
  static signRetryPayload(payload: RetryPayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto
      .createHmac('sha256', InstagramService.internalSecret())
      .update(body)
      .digest('base64url');
    return `${body}.${sig}`;
  }

  /** Verifikasi payload retry; null jika tanda tangan/expired tidak valid. */
  static verifyRetryPayload(token: string): RetryPayload | null {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;

    const expected = crypto
      .createHmac('sha256', InstagramService.internalSecret())
      .update(body)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as RetryPayload;
      const attempt = Number(payload?.attempt);
      const delayMs = payload?.delayMs == null ? 0 : Number(payload.delayMs);
      if (
        !payload?.fessId ||
        !payload?.baseHandle ||
        !Number.isInteger(attempt) ||
        attempt < 1 ||
        attempt >= AUTO_RETRY_MAX_ATTEMPTS ||
        !Number.isInteger(delayMs) ||
        delayMs < 0 ||
        delayMs > 15_000 ||
        !payload.exp ||
        Date.now() > payload.exp
      ) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  /** Kirim tugas retry ke endpoint internal (invocation baru). */
  private static async scheduleRetry(payload: RetryPayload): Promise<void> {
    const token = InstagramService.signRetryPayload(payload);
    const baseUrl = ENV.BACKEND_PUBLIC_URL.replace(/\/+$/, '');
    await axios.post(`${baseUrl}/internal/instagram/retry`, { token }, { timeout: 10000 });
  }

  /**
   * Worker retry: baca payload carousel yang tersimpan, lalu jalankan ulang
   * autoPostFess dengan nomor percobaan berikutnya.
   */
  static async retryInstagramPost(payload: RetryPayload): Promise<void> {
    try {
      // Beri jeda singkat agar rate limit / media fetch Meta sempat pulih.
      const delayMs = Math.max(0, Math.min(15_000, Number(payload.delayMs) || 0));
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const model: any = (prisma as any).fess;
      if (!model?.findUnique) return;

      const fess = await model.findUnique({
        where: { id: payload.fessId },
        select: {
          id: true,
          content: true,
          postedToIg: true,
          igStatus: true,
          igPayload: true,
        },
      });

      if (!fess || fess.postedToIg || fess.igStatus === 'published') return;

      const stored = (fess.igPayload || {}) as any;
      const items: PostMediaItem[] = Array.isArray(stored.items)
        ? stored.items.filter((item: any) => item && typeof item.url === 'string')
        : [];

      if (!items.length) {
        const detail = 'Payload carousel tidak ditemukan; retry tidak dapat dijalankan.';
        await InstagramService.updateFessIgState(payload.fessId, {
          igStatus: 'failed',
          igError: detail,
        });
        await InstagramService.writeAudit(
          `Retry fess #${payload.fessId} gagal: ${detail}`,
          'error'
        );
        return;
      }

      await InstagramService.autoPostFess(
        payload.baseHandle,
        payload.fessId,
        items,
        String(stored.caption || fess.content || ''),
        { attempt: payload.attempt, allowRetry: true }
      );
    } catch (err: any) {
      await InstagramService.updateFessIgState(payload.fessId, {
        igStatus: 'failed',
        igError: InstagramService.truncateIgError(
          `Retry gagal: ${err?.message || 'kesalahan tidak diketahui'}`
        ),
      });
      await InstagramService.writeAudit(
        `Retry auto-post fess #${payload.fessId} gagal: ${err?.message || 'kesalahan tidak diketahui'}`,
        'error'
      );
    }
  }

  /**
   * Worker finalize: tunggu container siap lalu publish. Jika belum siap
   * sebelum budget habis, jadwalkan ulang (rantai) dengan attempts+1.
   */
  static async finalizeInstagramPost(
    payload: FinalizePayload,
    deadlineTs = Date.now() + 50_000
  ): Promise<void> {
    let containerId = payload.containerId;

    try {
      const fess = prisma.fess?.findUnique
        ? await prisma.fess.findUnique({
            where: { id: payload.fessId },
            select: { id: true, content: true, postedToIg: true },
          })
        : null;
      if (!fess || fess.postedToIg) return; // sudah terbit / fess tidak ada

      const { baseIg, token } = await InstagramService.resolveInstagramConnection(payload.baseHandle);
      if (!token) {
        await InstagramService.auditFinalize(payload, baseIg, false, 'Koneksi Instagram tidak aktif.');
        return;
      }

      // Fase 1 — item container selesai? Lalu rakit carousel.
      if (!containerId) {
        const itemsReady = await InstagramService.waitForContainersFinished(
          payload.itemIds || [],
          token,
          deadlineTs - 3000
        );
        if (!itemsReady) {
          await InstagramService.updateFessIgState(payload.fessId, {
            igStatus: 'pending',
            igError: null,
          });
          await InstagramService.rescheduleFinalize(payload);
          return;
        }
        const captionText = InstagramService.buildCaption(String(fess.content || ''), payload.baseHandle);
        containerId = await InstagramService.createCarouselContainer(captionText, payload.itemIds || [], token);
      }

      // Fase 2 — container siap? Lalu publish.
      const containerReady = await InstagramService.waitForContainersFinished([containerId], token, deadlineTs);
      if (!containerReady) {
        await InstagramService.updateFessIgState(payload.fessId, {
          igStatus: 'pending',
          igError: null,
        });
        await InstagramService.rescheduleFinalize({ ...payload, containerId });
        return;
      }

      const pubRes = await InstagramService.publishContainerWithRetry(
        containerId,
        token,
        deadlineTs
      );
      const published = Boolean(pubRes.data?.id);
      // auditFinalize sekaligus menulis postedToIg=true. Jangan ada operasi DB
      // yang bisa melempar setelah publish sukses — reschedule akan menduplikasi.
      await InstagramService.auditFinalize(
        payload,
        baseIg,
        published,
        published ? null : 'Meta tidak mengembalikan id media.'
      );
    } catch (err: any) {
      const metaError = err?.response?.data?.error;
      let detail =
        metaError?.error_user_msg || metaError?.message || err?.message || 'unknown error';
      if (metaError?.code === 190) {
        detail += ' — token Instagram kedaluwarsa/dicabut, hubungkan ulang akun via Meta OAuth';
      }
      console.warn('[Instagram Finalize] gagal:', detail);

      // 9007/network/timeout masih bisa pulih: lanjutkan container yang sama
      // (atau fase 1 bila carousel belum dirakit) daripada langsung menyerah.
      if (InstagramService.isRetryableIgError(err, detail)) {
        await InstagramService.updateFessIgState(payload.fessId, {
          igStatus: 'pending',
          igError: null,
        });
        await InstagramService.rescheduleFinalize({ ...payload, containerId });
        return;
      }

      await InstagramService.auditFinalize(payload, payload.baseHandle, false, detail).catch(() => {});
    }
  }

  /** Jadwalkan ulang worker finalize (rantai antar-invocation). */
  private static async rescheduleFinalize(payload: FinalizePayload): Promise<void> {
    if (payload.attempts >= FINALIZE_MAX_ATTEMPTS) {
      await InstagramService.auditFinalize(
        payload,
        payload.baseHandle,
        false,
        `Belum selesai setelah ${FINALIZE_MAX_ATTEMPTS} percobaan.`
      ).catch(() => {});
      return;
    }
    try {
      await InstagramService.scheduleFinalize({ ...payload, attempts: payload.attempts + 1 });
    } catch (err: any) {
      const detail = `Gagal menjadwalkan kelanjutan otomatis: ${err?.message || err}`;
      console.warn('[Instagram Finalize]', detail);
      await InstagramService.auditFinalize(
        payload,
        payload.baseHandle,
        false,
        detail
      ).catch(() => {});
    }
  }

  /** Catat hasil akhir publikasi worker ke audit log. */
  private static async auditFinalize(
    payload: FinalizePayload,
    baseIg: string,
    published: boolean,
    detail: string | null
  ): Promise<void> {
    const label = payload.kind === 'carousel' ? 'carousel' : 'video Reels';

    if (published) {
      await InstagramService.updateFessIgState(payload.fessId, {
        igStatus: 'published',
        igError: null,
        postedToIg: true,
      });
    } else {
      await InstagramService.updateFessIgState(payload.fessId, {
        igStatus: 'failed',
        igError: InstagramService.truncateIgError(
          detail || 'Publikasi Instagram gagal tanpa detail.'
        ),
      });
    }

    try {
      await prisma.systemLog.create({
        data: {
          source: 'CANVAS_WORKER',
          message: published
            ? `Fess #${payload.fessId} berhasil dipublikasikan ke Instagram Feed ${baseIg} (${label}).`
            : `Fess #${payload.fessId} GAGAL dipublikasikan ke Instagram Feed ${baseIg} (${label})${detail ? `: ${detail}` : '.'}`,
          tone: published ? 'ok' : 'error',
        },
      });
    } catch {
      // Audit log best-effort — jangan mengubah status publikasi yang sudah final.
    }
  }

  /**
   * Susun caption final: isi fess selengkap mungkin + branding, dipotong
   * hanya jika melebihi batas 2200 karakter caption Instagram.
   */
  static buildCaption(content: string, baseHandle: string): string {
    const suffix = `\n\nDiposting via Fess n Curious (${baseHandle})`;
    let body = content;
    if (body.length + suffix.length > 2200) {
      body = `${body.slice(0, Math.max(0, 2200 - suffix.length - 1)).trimEnd()}\u2026`;
    }
    return `${body}${suffix}`;
  }

  /**
   * Tunggu beberapa container media Meta selesai diproses (status FINISHED)
   * sebelum dipakai/dipublikasikan — status tiap container dicek paralel.
   * Mengembalikan false jika deadline habis (masih IN_PROGRESS); melempar
   * error jika container berstatus ERROR/EXPIRED.
   */
  private static async waitForContainersFinished(
    containerIds: string[],
    accessToken: string,
    deadlineTs = Date.now() + 30_000
  ): Promise<boolean> {
    const pending = new Set(containerIds.filter(Boolean));
    if (pending.size === 0) return true;

    while (pending.size > 0 && Date.now() < deadlineTs) {
      const results = await Promise.allSettled(
        Array.from(pending).map(async (id) => {
          const statusRes = await axios.get(`${API_BASE}/${id}`, {
            params: { fields: 'status_code', access_token: accessToken },
            timeout: 10000,
          });
          return { id, status: String(statusRes.data?.status_code || 'IN_PROGRESS') };
        })
      );

      for (const res of results) {
        if (res.status === 'fulfilled') {
          if (res.value.status === 'FINISHED') {
            pending.delete(res.value.id);
          } else if (res.value.status === 'ERROR' || res.value.status === 'EXPIRED') {
            throw new Error(
              `Container media Meta berstatus ${res.value.status} - periksa format/rasio media.`
            );
          }
        } else {
          const err: any = res.reason;
          console.warn(
            '[Instagram AutoPost] Status check warning:',
            err?.response?.data?.error?.message || err?.message
          );
        }
      }

      if (pending.size > 0) await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    return pending.size === 0;
  }
}
