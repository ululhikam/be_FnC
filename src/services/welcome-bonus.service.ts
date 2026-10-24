import type { Prisma } from '@prisma/client';
import { ENV } from '../config/env.js';
import { CtfWalletService } from './ctf-wallet.service.js';

export const WELCOME_BONUS_IDEMPOTENCY_PREFIX = 'welcome-bonus:';

export type WelcomeBonusSource = 'email_verification' | 'google_signup';

export class WelcomeBonusService {
  /**
   * Grant the one-time new-user welcome bonus. The idempotency key is derived
   * from the user id, so retries and duplicate verification requests can never
   * credit the same account twice.
   *
   * Call this only when a user is newly created or has just verified their
   * email for the first time. Existing verified users are intentionally not
   * backfilled.
   */
  static async grant(
    userId: string,
    tx?: Prisma.TransactionClient,
    source: WelcomeBonusSource = 'email_verification'
  ) {
    const amount = ENV.WELCOME_CTF_BONUS;
    if (amount <= 0) return null;

    return CtfWalletService.credit(
      {
        userId,
        amount,
        type: 'WELCOME_BONUS',
        idempotencyKey: `${WELCOME_BONUS_IDEMPOTENCY_PREFIX}${userId}`,
        referenceType: 'user',
        referenceId: userId,
        metadata: {
          reason: 'new_user_welcome',
          source,
        },
      },
      tx
    );
  }
}
