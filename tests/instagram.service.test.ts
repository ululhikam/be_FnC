import { describe, it, expect, vi, beforeEach } from 'vitest';
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
      handle: '@codememfess_ig',
    });

    expect(result.verified).toBe(true);
    expect(result.profile.username).toBe('@codememfess_ig');
    expect(prisma.user.update).toHaveBeenCalled();
    expect(prisma.platformConnection.upsert).toHaveBeenCalled();
    expect(prisma.systemLog.create).toHaveBeenCalled();
  });

  it('should auto-post confession to Instagram Feed via Graph API and log activity', async () => {
    const result = await InstagramService.autoPostFess(
      '@codememfess',
      'fess_101',
      'https://storage/canvas_101.svg',
      'Confession caption'
    );

    expect(result.success).toBe(true);
    expect(result.platform).toBe('instagram');
    expect(prisma.systemLog.create).toHaveBeenCalled();
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
