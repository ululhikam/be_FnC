import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CtfLedgerType } from '@prisma/client';
import { ENV } from '../src/config/env.js';

const credit = vi.hoisted(() => vi.fn());

vi.mock('../src/services/ctf-wallet.service.js', () => ({
  CtfWalletService: { credit },
}));

import { WelcomeBonusService } from '../src/services/welcome-bonus.service.js';

describe('WelcomeBonusService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ENV.WELCOME_CTF_BONUS = 1;
  });

  it('credits exactly one CTF with a stable welcome-bonus idempotency key', async () => {
    credit.mockResolvedValueOnce({ balance: 1, idempotent: false } as any);

    const result = await WelcomeBonusService.grant('usr_welcome');

    expect(result).toEqual({ balance: 1, idempotent: false });
    expect(credit).toHaveBeenCalledWith(
      {
        userId: 'usr_welcome',
        amount: 1,
        type: CtfLedgerType.WELCOME_BONUS,
        idempotencyKey: 'welcome-bonus:usr_welcome',
        referenceType: 'user',
        referenceId: 'usr_welcome',
        metadata: {
          reason: 'new_user_welcome',
          source: 'email_verification',
        },
      },
      undefined
    );
  });

  it('does nothing when the welcome bonus is disabled', async () => {
    ENV.WELCOME_CTF_BONUS = 0;

    const result = await WelcomeBonusService.grant('usr_welcome');

    expect(result).toBeNull();
    expect(credit).not.toHaveBeenCalled();
  });

  it('passes the transaction client and Google signup source through', async () => {
    const tx = { user: {} } as any;
    credit.mockResolvedValueOnce({ balance: 1 } as any);

    await WelcomeBonusService.grant('usr_google', tx, 'google_signup');

    expect(credit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'usr_google',
        metadata: {
          reason: 'new_user_welcome',
          source: 'google_signup',
        },
      }),
      tx
    );
  });
});
