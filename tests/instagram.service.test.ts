import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstagramService } from '../src/services/instagram.service.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
    platformConnection: {
      upsert: vi.fn(),
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

  it('should auto-post confession to Instagram Story via Graph API and log activity', async () => {
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
});
