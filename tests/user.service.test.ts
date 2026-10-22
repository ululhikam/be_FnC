import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from '../src/services/user.service.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    base: {
      findFirst: vi.fn(),
    },
  },
}));

const DAY_MS = 24 * 60 * 60 * 1000;

function serializedUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'usr_1',
    username: 'Alice',
    handle: '@alice',
    email: 'alice@mail.com',
    role: 'User',
    badges: [],
    managedBases: [],
    createdAt: new Date(),
    ...overrides,
  };
}

describe('UserService — profile handle cooldown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not expose cooldown metadata on the public profile', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      serializedUser({ handleChangedAt: new Date() }) as any
    );

    const result = await UserService.getProfile('usr_1');

    expect(result.user).not.toHaveProperty('can_change_handle');
    expect(result.user).not.toHaveProperty('handle_change_available_at');
    expect(result.user).not.toHaveProperty('handle_changed_at');
  });

  it('allows the first handle change and records the change time', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'usr_1',
      handle: '@alice',
      handleChangedAt: null,
    } as any);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.base.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.user.update).mockResolvedValueOnce(
      serializedUser({ handle: '@alice_new', handleChangedAt: new Date() }) as any
    );

    const result = await UserService.updateProfile('usr_1', {
      handle: 'alice_new',
    });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          handle: '@alice_new',
          handleChangedAt: expect.any(Date),
        }),
      })
    );
    expect(result.user.handle).toBe('@alice_new');
    expect(result.user.can_change_handle).toBe(false);
  });

  it('rejects a handle change while the 7-day cooldown is still active', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'usr_1',
      handle: '@alice',
      handleChangedAt: new Date(Date.now() - 3 * DAY_MS),
    } as any);

    await expect(
      UserService.updateProfile('usr_1', { handle: '@alice_new' })
    ).rejects.toMatchObject({
      status: 429,
      code: 'HANDLE_CHANGE_COOLDOWN',
    });

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.base.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not treat submitting the same handle as a cooldown violation', async () => {
    const changedAt = new Date(Date.now() - 3 * DAY_MS);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'usr_1',
      handle: '@alice',
      handleChangedAt: changedAt,
    } as any);
    vi.mocked(prisma.user.update).mockResolvedValueOnce(
      serializedUser({ handleChangedAt: changedAt }) as any
    );

    await expect(
      UserService.updateProfile('usr_1', {
        username: 'Alice Updated',
        handle: '@alice',
      })
    ).resolves.toBeDefined();

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { username: 'Alice Updated' },
      })
    );
  });

  it('rejects a handle that is already used by a user or base', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'usr_1',
      handle: '@alice',
      handleChangedAt: null,
    } as any);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: 'usr_2' } as any);
    vi.mocked(prisma.base.findFirst).mockResolvedValueOnce(null);

    await expect(
      UserService.updateProfile('usr_1', { handle: '@taken' })
    ).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });

    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
