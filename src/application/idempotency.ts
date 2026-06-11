import { IdempotencyConflictError } from '../domain/errors.js';
import type { Transaction, TransactionType } from '../domain/transaction.js';
import type { TransactionRepository } from './ports/transaction-repository.js';

export interface IdempotentRequestShape {
  readonly type: TransactionType;
  readonly amountCents: number;
  readonly accountIds: readonly string[];
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

  const existing = await transactions.findByIdempotencyKey(key);
  if (!existing) {
    return null;
  }

  const storedAccountIds = new Set(existing.entries.map((entry) => entry.accountId));
  const storedAmount = existing.entries
    .filter((entry) => entry.direction === 'CREDIT')
    .reduce((total, entry) => total + entry.amountCents, 0);

  const matches =
    existing.type === request.type &&
    storedAmount === request.amountCents &&
    request.accountIds.every((id) => storedAccountIds.has(id));

  if (!matches) {
    throw new IdempotencyConflictError(key);
  }

  return existing;
}
