import { Prisma } from '@prisma/client';
import type { CtfLedgerType } from '@prisma/client';
import { prisma } from '../config/prisma.js';

type DbClient = Prisma.TransactionClient | typeof prisma;

export type CtfWalletMutationInput = {
  userId: string;
  amount: number;
  type: CtfLedgerType;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Prisma.InputJsonValue;
};

export type CtfWalletMutationResult = {
  walletId: string;
  userId: string;
  balance: number;
  idempotent: boolean;
  entry: {
    id: string;
    type: CtfLedgerType;
    amount: number;
    balanceAfter: number;
    idempotencyKey: string;
    createdAt: Date;
  };
};

export class CtfWalletError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'CtfWalletError';
    this.code = code;
    this.status = status;
  }
}

const MAX_CTF_TRANSACTION = 1_000_000;
const MAX_IDEMPOTENCY_KEY_LENGTH = 180;

function assertAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_CTF_TRANSACTION) {
    throw new CtfWalletError(
      'INVALID_CTF_AMOUNT',
      `Nominal CTF harus bilangan bulat antara 1 dan ${MAX_CTF_TRANSACTION}`,
      400
    );
  }
}

function assertIdempotencyKey(idempotencyKey: string) {
  if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new CtfWalletError(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency key wajib diisi dan maksimal 180 karakter',
      400
    );
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export class CtfWalletService {
  /**
   * Return the wallet for a user, creating it lazily if needed.
   * Safe to call inside a Prisma transaction.
   */
  static async getOrCreateWallet(userId: string, tx?: Prisma.TransactionClient) {
    const client: DbClient = tx ?? prisma;
    return client.ctfWallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { id: true, userId: true, balance: true },
    });
  }

  /**
   * Read-only balance. A missing wallet means zero CTF, without writing.
   */
  static async getBalance(userId: string) {
    const wallet = await prisma.ctfWallet.findUnique({
      where: { userId },
      select: { balance: true },
    });
    return wallet?.balance ?? 0;
  }

  /**
   * Credit CTF atomically. The idempotency key is globally unique; repeating
   * the same operation returns the existing ledger entry instead of crediting twice.
   */
  static async credit(input: CtfWalletMutationInput, tx?: Prisma.TransactionClient) {
    assertAmount(input.amount);
    assertIdempotencyKey(input.idempotencyKey);
    return this.execute(input, input.amount, tx);
  }

  /**
   * Debit CTF atomically. The conditional UPDATE guarantees that a wallet can
   * never go below zero, even when two requests race.
   */
  static async debit(input: CtfWalletMutationInput, tx?: Prisma.TransactionClient) {
    assertAmount(input.amount);
    assertIdempotencyKey(input.idempotencyKey);
    return this.execute(input, -input.amount, tx);
  }

  private static async execute(
    input: CtfWalletMutationInput,
    signedAmount: number,
    tx?: Prisma.TransactionClient
  ): Promise<CtfWalletMutationResult> {
    if (tx) {
      return this.applyWithClient(tx, input, signedAmount);
    }

    try {
      return await prisma.$transaction(
        (transaction) => this.applyWithClient(transaction, input, signedAmount),
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      );
    } catch (error) {
      // A concurrent request may have inserted the same idempotency key after
      // our initial lookup. If so, the unique index made our transaction roll
      // back; return the winner's entry as an idempotent success.
      if (isUniqueConstraintError(error)) {
        const existing = await prisma.ctfLedgerEntry.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { wallet: { select: { id: true, balance: true } } },
        });
        if (existing) {
          this.assertSameOperation(existing, input, signedAmount);
          return {
            walletId: existing.walletId,
            userId: existing.userId,
            balance: existing.wallet?.balance ?? existing.balanceAfter,
            idempotent: true,
            entry: this.serializeEntry(existing),
          };
        }
      }
      throw error;
    }
  }

  private static async applyWithClient(
    client: DbClient,
    input: CtfWalletMutationInput,
    signedAmount: number
  ): Promise<CtfWalletMutationResult> {
    const existing = await client.ctfLedgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { wallet: { select: { id: true, balance: true } } },
    });

    if (existing) {
      this.assertSameOperation(existing, input, signedAmount);
      return {
        walletId: existing.walletId,
        userId: existing.userId,
        balance: existing.wallet?.balance ?? existing.balanceAfter,
        idempotent: true,
        entry: this.serializeEntry(existing),
      };
    }

    const wallet = await this.getOrCreateWallet(input.userId, client as Prisma.TransactionClient);
    let balanceAfter: number;

    if (signedAmount > 0) {
      const updated = await client.ctfWallet.update({
        where: { userId: input.userId },
        data: { balance: { increment: signedAmount } },
        select: { balance: true },
      });
      balanceAfter = updated.balance;
    } else {
      const amount = Math.abs(signedAmount);
      const updated = await client.ctfWallet.updateMany({
        where: { userId: input.userId, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });

      if (updated.count !== 1) {
        throw new CtfWalletError(
          'INSUFFICIENT_CTF',
          'Saldo CTF tidak mencukupi untuk melakukan transaksi ini',
          402
        );
      }

      const after = await client.ctfWallet.findUnique({
        where: { userId: input.userId },
        select: { balance: true },
      });
      balanceAfter = after?.balance ?? 0;
    }

    const entry = await client.ctfLedgerEntry.create({
      data: {
        walletId: wallet.id,
        userId: input.userId,
        type: input.type,
        amount: signedAmount,
        balanceAfter,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      },
      select: {
        id: true,
        type: true,
        amount: true,
        balanceAfter: true,
        idempotencyKey: true,
        createdAt: true,
        walletId: true,
        userId: true,
      },
    });

    return {
      walletId: wallet.id,
      userId: input.userId,
      balance: balanceAfter,
      idempotent: false,
      entry: this.serializeEntry(entry),
    };
  }

  private static assertSameOperation(
    existing: {
      userId: string;
      type: CtfLedgerType;
      amount: number;
    },
    input: CtfWalletMutationInput,
    signedAmount: number
  ) {
    if (
      existing.userId !== input.userId ||
      existing.type !== input.type ||
      existing.amount !== signedAmount
    ) {
      throw new CtfWalletError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key sudah dipakai untuk operasi CTF yang berbeda',
        409
      );
    }
  }

  private static serializeEntry(entry: {
    id: string;
    type: CtfLedgerType;
    amount: number;
    balanceAfter: number;
    idempotencyKey: string;
    createdAt: Date;
  }) {
    return {
      id: entry.id,
      type: entry.type,
      amount: entry.amount,
      balanceAfter: entry.balanceAfter,
      idempotencyKey: entry.idempotencyKey,
      createdAt: entry.createdAt,
    };
  }
}
