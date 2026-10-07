import { IdempotencyConflictError } from '../domain/errors.js';
import type { EntryDirection, Transaction, TransactionType } from '../domain/transaction.js';
import type { TransactionRepository } from './ports/transaction-repository.js';

export interface IdempotentRequestShape {
  readonly type: TransactionType;
  readonly entryCount: number;
  readonly legs: readonly {
    accountId: string;
    direction: EntryDirection;
    amountCents: number;
  }[];
}

/**
 * Returns the previously stored transaction when the same idempotency key is
 * replayed with an identical payload, or throws when the key is being reused
 * for a different operation. Returns null when the key is unseen.
 */
export async function findReplayedTransaction(
  transactions: TransactionRepository,
  key: string | undefined,
  request: IdempotentRequestShape,
): Promise<Transaction | null> {
  if (!key) {
    return null;
  }

  // PostgreSQL serializes requests sharing a key before the lookup. The lock
  // lasts until commit/rollback, including requests touching different accounts.
  await transactions.lockIdempotencyKey(key);

  const existing = await transactions.findByIdempotencyKey(key);
  if (!existing) {
    return null;
  }

  const matches =
    existing.type === request.type &&
    existing.entries.length === request.entryCount &&
    request.legs.every((leg) =>
      existing.entries.some(
        (entry) =>
          entry.accountId === leg.accountId &&
          entry.direction === leg.direction &&
          entry.amountCents === leg.amountCents,
      ),
    );

  if (!matches) {
    throw new IdempotencyConflictError(key);
  }

  return existing;
}
