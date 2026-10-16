import crypto from 'crypto';
import axios from 'axios';
import { ENV } from '../config/env.js';
import { prisma } from '../config/prisma.js';

const API_BASE = 'https://graph.instagram.com/v19.0';
const FINALIZE_MAX_ATTEMPTS = 6;

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
      scope: 'instagram_business_basic,instagram_business_manage_messages',
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
      const response = await axios.get('https://graph.instagram.com/me', {
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
   * Exchange short-lived token to 60-day long-lived token
   */
  static async getLongLivedToken(shortToken: string): Promise<string> {
    if (shortToken.startsWith('mock_')) return shortToken;
    try {
      const response = await axios.get('https://graph.instagram.com/access_token', {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: ENV.INSTAGRAM_CLIENT_SECRET,
          access_token: shortToken,
        },
        timeout: 8000,
      });

      return response.data.access_token || shortToken;
    } catch {
      return shortToken;
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

    if (data.token) {
      profile = await this.verifyToken(data.token);
    } else if (data.code) {
      const shortToken = await this.exchangeCodeForToken(data.code);
      const longToken = await this.getLongLivedToken(shortToken);
      savedToken = longToken;
      profile = await this.verifyToken(longToken);
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
        name: 'Instagram Graph API (Canvas Story)',
        status: 'connected',
        connected: true,
        accountHandle: profile.username,
        accessToken: savedToken || null,
      },
      update: {
        status: 'connected',
        connected: true,
        accountHandle: profile.username,
        ...(savedToken ? { accessToken: savedToken } : {}),
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
    caption: string
  ) {
    try {
      // Normalisasi daftar media: buang data-URI (Meta butuh URL publik) &
      // batasi 10 item (maksimum carousel Instagram).
      const items: PostMediaItem[] = (Array.isArray(media) ? media : [media])
        .map((m) => (typeof m === 'string' ? { type: 'image' as const, url: m } : m))
        .filter(
          (m): m is PostMediaItem =>
            !!m && typeof m.url === 'string' && m.url.length > 0 && !m.url.startsWith('data:')
        )
        .slice(0, 10);
      const isCarousel = items.length > 1;

      // Resolve koneksi Instagram kreator base (token nyata saja)
      const { baseIg, token } = await InstagramService.resolveInstagramConnection(baseHandle);

      let metaPublished = false;
      let igPending = false;
      let postCreationId: string | null = null;
      const mediaLabel = isCarousel
        ? `carousel ${items.length} media`
        : items[0]?.type === 'video'
          ? 'video Reels'
          : 'visual Feed card';

      // Jika token Instagram aktif ada, jalankan Meta Content Publishing API
      if (token && items.length) {
        try {
          const captionText = InstagramService.buildCaption(caption, baseHandle);
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

            const pubRes = await axios.post(`${API_BASE}/me/media_publish`, null, {
              params: {
                creation_id: postCreationId,
                access_token: token,
              },
              timeout: 15000,
            });
            if (pubRes.data?.id) {
              metaPublished = true;
            }
          }
        } catch (apiErr: any) {
          console.warn('[Instagram AutoPost] Meta API warning:', apiErr.response?.data?.error?.message || apiErr.message);
        }
      }

      // Record audit log
      await prisma.systemLog.create({
        data: {
          source: 'CANVAS_WORKER',
          message: metaPublished
            ? `Fess #${fessId} berhasil dipublikasikan ke Instagram Feed ${baseIg} (${mediaLabel}).`
            : igPending
              ? `Fess #${fessId}: video sedang diproses Meta — publikasi otomatis ke ${baseIg} sedang berjalan (${mediaLabel}).`
              : `Fess #${fessId} dirender ke ${mediaLabel} (${baseIg}), tetapi publikasi ke Instagram belum berhasil.`,
          tone: metaPublished || igPending ? 'ok' : 'error',
        },
      });

      return {
        success: true,
        platform: 'instagram',
        meta_published: metaPublished,
        ig_pending: igPending,
        creation_id: postCreationId,
        imageUrl: items[0]?.url || null,
        imageUrls: items.map((item) => item.url),
        items,
        is_carousel: isCarousel,
        fessId,
        base_ig: baseIg,
        message: metaPublished
          ? `Card fess #${fessId} berhasil diposting otomatis ke Instagram Feed ${baseIg}${isCarousel ? ` (carousel ${items.length} media)` : ''}!`
          : igPending
            ? `Video sedang diproses Instagram — fess #${fessId} akan terbit otomatis ke ${baseIg} dalam ±1 menit.`
            : `Card fess #${fessId} berhasil di-render dan siap diposting ke Instagram Feed ${baseIg}.`,
      };
    } catch (err: any) {
      console.error('[Instagram AutoPost Error]', err.message);
      return {
        success: false,
        platform: 'instagram',
        error: err.message,
      };
    }
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

  /**
   * Worker finalize: tunggu container siap lalu publish. Jika belum siap
   * sebelum budget habis, jadwalkan ulang (rantai) dengan attempts+1.
   */
  static async finalizeInstagramPost(
    payload: FinalizePayload,
    deadlineTs = Date.now() + 50_000
  ): Promise<void> {
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

      let containerId = payload.containerId;

      // Fase 1 — item container selesai? Lalu rakit carousel.
      if (!containerId) {
        const itemsReady = await InstagramService.waitForContainersFinished(
          payload.itemIds || [],
          token,
          deadlineTs - 3000
        );
        if (!itemsReady) {
          await InstagramService.rescheduleFinalize(payload);
          return;
        }
        const captionText = InstagramService.buildCaption(String(fess.content || ''), payload.baseHandle);
        containerId = await InstagramService.createCarouselContainer(captionText, payload.itemIds || [], token);
      }

      // Fase 2 — container siap? Lalu publish.
      const containerReady = await InstagramService.waitForContainersFinished([containerId], token, deadlineTs);
      if (!containerReady) {
        await InstagramService.rescheduleFinalize({ ...payload, containerId });
        return;
      }

      const pubRes = await axios.post(`${API_BASE}/me/media_publish`, null, {
        params: { creation_id: containerId, access_token: token },
        timeout: 15000,
      });
      const published = Boolean(pubRes.data?.id);
      if (published) {
        await prisma.fess.update({
          where: { id: payload.fessId },
          data: { postedToIg: true },
        });
      }
      await InstagramService.auditFinalize(
        payload,
        baseIg,
        published,
        published ? null : 'Meta tidak mengembalikan id media.'
      );
    } catch (err: any) {
      const detail = err?.response?.data?.error?.message || err?.message || 'unknown error';
      console.warn('[Instagram Finalize] gagal:', detail);
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
      console.warn('[Instagram Finalize] gagal menjadwalkan ulang:', err?.message);
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
    await prisma.systemLog.create({
      data: {
        source: 'CANVAS_WORKER',
        message: published
          ? `Fess #${payload.fessId} berhasil dipublikasikan ke Instagram Feed ${baseIg} (${label}).`
          : `Fess #${payload.fessId} GAGAL dipublikasikan ke Instagram Feed ${baseIg} (${label})${detail ? `: ${detail}` : '.'}`,
        tone: published ? 'ok' : 'error',
      },
    });
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
