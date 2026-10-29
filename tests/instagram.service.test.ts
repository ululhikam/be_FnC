import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { InstagramService } from '../src/services/instagram.service.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    user: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    platformConnection: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    base: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    systemLog: {
      create: vi.fn(),
    },
  },
}));

describe('InstagramService Unit Tests (Meta for Developers Graph API)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should verify Instagram token and return profile data', async () => {
    const profile = await InstagramService.verifyToken('mock_token_123');
    expect(profile.verified).toBe(true);
    expect(profile.username).toBeDefined();
    expect(profile.username.startsWith('@')).toBe(true);
  });

  it('should exchange Meta authorization code for token', async () => {
    const token = await InstagramService.exchangeCodeForToken('meta_oauth_code_xyz');
    expect(typeof token).toBe('string');
  });

  it('URL authorization meminta content_publish & tidak meminta manage_messages', () => {
    const url = InstagramService.getAuthorizationUrl('state_abc');
    expect(url).toContain('instagram_business_basic');
    expect(url).toContain('instagram_business_content_publish');
    expect(url).not.toContain('manage_messages');
    expect(url).toContain('state=state_abc');
  });

  it('should verify and link Instagram account to user', async () => {
    vi.mocked(prisma.user.update).mockResolvedValueOnce({
      id: 'usr_mod',
      igAccount: '@codememfess_ig',
    } as any);

    const result = await InstagramService.verifyAndLinkAccount('usr_mod', {
      token: 'mock_token_123',
    });

    expect(result.verified).toBe(true);
    expect(result.profile.username).toBeDefined();
    expect(prisma.user.update).toHaveBeenCalled();
    expect(prisma.platformConnection.upsert).toHaveBeenCalled();
    expect(prisma.systemLog.create).toHaveBeenCalled();
  });

  it('tidak menautkan base yang bukan milik user saat OAuth', async () => {
    vi.mocked(prisma.user.update).mockResolvedValueOnce({ id: 'usr_mod' } as any);
    vi.mocked(prisma.base.findFirst).mockResolvedValueOnce(null);

    await InstagramService.verifyAndLinkAccount('usr_mod', {
      token: 'mock_token_123',
      baseHandle: '@base_tenant_lain',
    });

    expect(prisma.base.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ creatorId: 'usr_mod' }),
      })
    );
    expect(prisma.base.update).not.toHaveBeenCalled();
  });

  // Handle bukan bukti kepemilikan akun Instagram: sebelumnya service mengarang
  // profil "verified" dari string handle, sehingga siapa pun bisa mengklaim
  // handle orang lain dan merebut binding IG-nya.
  it('menolak verifikasi berbasis handle tanpa OAuth Meta', async () => {
    await expect(
      InstagramService.verifyAndLinkAccount('usr_mod', { handle: '@korban' } as any)
    ).rejects.toMatchObject({ status: 400, code: 'INSTAGRAM_OAUTH_REQUIRED' });

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('should treat a missing Instagram connection as a clean FnC-only skip', async () => {
    vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
      igAccount: '@codememfess',
      creatorId: 'usr_mod',
    } as any);
    vi.mocked(prisma.platformConnection.findUnique).mockResolvedValueOnce(null);

    const result = await InstagramService.autoPostFess(
      '@codememfess',
      'fess_101',
      'https://storage/canvas_101.svg',
      'Confession caption'
    );

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      meta_published: false,
      ig_pending: false,
      ig_status: 'skipped',
      base_ig: '@codememfess',
    });
    expect((result as any).error).toBeUndefined();
    expect(prisma.systemLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tone: 'info' }),
    });
  });

  it('should delete published media via the documented Graph API endpoint', async () => {
    vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
      igAccount: '@base_ig',
      creatorId: 'usr_creator',
    } as any);
    vi.mocked(prisma.platformConnection.findUnique).mockResolvedValueOnce({
      connected: true,
      accessToken: 'ig_token',
    } as any);
    const deleteRequest = vi
      .spyOn(axios, 'delete')
      .mockResolvedValueOnce({ data: { success: true, deleted_id: 'ig_media_1' } } as any);

    const result = await InstagramService.deletePublishedPost('ig_media_1', '@base');

    expect(result.ok).toBe(true);
    expect(deleteRequest).toHaveBeenCalledWith(
      expect.stringContaining('/ig_media_1'),
      expect.objectContaining({ params: { access_token: 'ig_token' } })
    );
    deleteRequest.mockRestore();
  });

  it('should report a missing Instagram connection instead of throwing', async () => {
    vi.mocked(prisma.base.findUnique).mockResolvedValueOnce({
      igAccount: '@base_ig',
      creatorId: 'usr_creator',
    } as any);
    vi.mocked(prisma.platformConnection.findUnique).mockResolvedValueOnce(null);

    const result = await InstagramService.deletePublishedPost('ig_media_1', '@base');

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('tidak aktif');
  });

  it('should build an Instagram caption with branding and a 2200-char cap', () => {
    const short = InstagramService.buildCaption('Halo dunia', '@codememfess');
    expect(short).toBe('Halo dunia\n\nDiposting via Fess n Curious (@codememfess)');

    const long = InstagramService.buildCaption('A'.repeat(2500), '@codememfess');
    expect(long).toHaveLength(2200);
    expect(long).toContain('\u2026');
    expect(long.endsWith(')')).toBe(true);
  });
});
