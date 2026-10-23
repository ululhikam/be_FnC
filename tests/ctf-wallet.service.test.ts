import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CtfLedgerType } from '@prisma/client';

const fake = vi.hoisted(() => {
  const wallets = new Map<string, { id: string; userId: string; balance: number }>();
  const entries = new Map<string, any>();
  let walletSeq = 0;
  let entrySeq = 0;

  const ctfWallet = {
    upsert: vi.fn(async ({ where, create }: any) => {
      let wallet = wallets.get(where.userId);
      if (!wallet) {
        wallet = {
          id: `wallet_${++walletSeq}`,
          userId: where.userId ?? create.userId,
          balance: 0,
        };
        wallets.set(wallet.userId, wallet);
      }
      return { id: wallet.id, userId: wallet.userId, balance: wallet.balance };
    }),
    findUnique: vi.fn(async ({ where }: any) => {
      const wallet = wallets.get(where.userId);
      return wallet ? { ...wallet } : null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const wallet = wallets.get(where.userId);
      if (!wallet) throw new Error('wallet not found');
      wallet.balance += data.balance.increment;
      return { balance: wallet.balance };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const wallet = wallets.get(where.userId);
      if (!wallet || wallet.balance < where.balance.gte) return { count: 0 };
      wallet.balance -= data.balance.decrement;
      return { count: 1 };
    }),
  };

  const ctfLedgerEntry = {
    findUnique: vi.fn(async ({ where }: any) => {
      const entry = entries.get(where.idempotencyKey);
      if (!entry) return null;
      return { ...entry, wallet: wallets.get(entry.userId) };
    }),
    create: vi.fn(async ({ data }: any) => {
      if (entries.has(data.idempotencyKey)) throw new Error('duplicate key');
      const entry = {
        id: `entry_${++entrySeq}`,
        ...data,
        createdAt: new Date('2026-10-24T00:00:00.000Z'),
      };
      entries.set(data.idempotencyKey, entry);
      return entry;
    }),
  };

  const prisma = {
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
    ctfWallet,
    ctfLedgerEntry,
  };

  return {
    wallets,
    entries,
    ctfWallet,
    ctfLedgerEntry,
    prisma,
    reset() {
      wallets.clear();
      entries.clear();
      walletSeq = 0;
      entrySeq = 0;
    },
  };
});

vi.mock('../src/config/prisma.js', () => ({ prisma: fake.prisma }));

import { CtfWalletError, CtfWalletService } from '../src/services/ctf-wallet.service.js';

describe('CtfWalletService', () => {
  beforeEach(() => {
    fake.reset();
    vi.clearAllMocks();
  });

  it('credits CTF and writes a positive ledger entry', async () => {
    const result = await CtfWalletService.credit({
      userId: 'usr_1',
      amount: 25,
      type: CtfLedgerType.TOPUP,
      idempotencyKey: 'topup:order_1',
      referenceType: 'payment_order',
      referenceId: 'order_1',
    });

    expect(result.balance).toBe(25);
    expect(result.idempotent).toBe(false);
    expect(result.entry.amount).toBe(25);
    expect(fake.wallets.get('usr_1')?.balance).toBe(25);
    expect(fake.entries.size).toBe(1);
  });

  it('returns the same result when the idempotency key is replayed', async () => {
    const input = {
      userId: 'usr_1',
      amount: 25,
      type: CtfLedgerType.TOPUP,
      idempotencyKey: 'topup:order_1',
    } as const;

    const first = await CtfWalletService.credit(input);
    const second = await CtfWalletService.credit(input);

    expect(first.balance).toBe(25);
    expect(second.balance).toBe(25);
    expect(second.idempotent).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(fake.wallets.get('usr_1')?.balance).toBe(25);
    expect(fake.entries.size).toBe(1);
  });

  it('debits CTF atomically and writes a negative ledger entry', async () => {
    await CtfWalletService.credit({
      userId: 'usr_1',
      amount: 100,
      type: CtfLedgerType.TOPUP,
      idempotencyKey: 'topup:order_1',
    });

    const result = await CtfWalletService.debit({
      userId: 'usr_1',
      amount: 40,
      type: CtfLedgerType.FESS_CHARGE,
      idempotencyKey: 'fess:fess_1',
      referenceType: 'fess',
      referenceId: 'fess_1',
    });

    expect(result.balance).toBe(60);
    expect(result.entry.amount).toBe(-40);
    expect(fake.wallets.get('usr_1')?.balance).toBe(60);
  });

  it('rejects a debit that would make the wallet negative', async () => {
    await expect(
      CtfWalletService.debit({
        userId: 'usr_1',
        amount: 10,
        type: CtfLedgerType.FESS_CHARGE,
        idempotencyKey: 'fess:fess_1',
      })
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_CTF',
      status: 402,
    });

    expect(fake.wallets.get('usr_1')?.balance).toBe(0);
    expect(fake.entries.size).toBe(0);
  });

  it('rejects invalid CTF amounts before touching the wallet', async () => {
    await expect(
      CtfWalletService.credit({
        userId: 'usr_1',
        amount: 0,
        type: CtfLedgerType.TOPUP,
        idempotencyKey: 'topup:zero',
      })
    ).rejects.toBeInstanceOf(CtfWalletError);

    await expect(
      CtfWalletService.credit({
        userId: 'usr_1',
        amount: 1.5,
        type: CtfLedgerType.TOPUP,
        idempotencyKey: 'topup:fraction',
      })
    ).rejects.toMatchObject({ code: 'INVALID_CTF_AMOUNT' });

    expect(fake.entries.size).toBe(0);
  });

  it('rejects reusing an idempotency key for a different operation', async () => {
    await CtfWalletService.credit({
      userId: 'usr_1',
      amount: 25,
      type: CtfLedgerType.TOPUP,
      idempotencyKey: 'shared:key',
    });

    await expect(
      CtfWalletService.debit({
        userId: 'usr_1',
        amount: 10,
        type: CtfLedgerType.FESS_CHARGE,
        idempotencyKey: 'shared:key',
      })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
  });

  it('returns zero for a user without a wallet', async () => {
    await expect(CtfWalletService.getBalance('usr_missing')).resolves.toBe(0);
    expect(fake.wallets.has('usr_missing')).toBe(false);
  });

  it('creates a wallet lazily', async () => {
    const wallet = await CtfWalletService.getOrCreateWallet('usr_new');
    expect(wallet.userId).toBe('usr_new');
    expect(wallet.balance).toBe(0);
    expect(fake.wallets.has('usr_new')).toBe(true);
  });
});
