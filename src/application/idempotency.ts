import { IdempotencyConflictError } from '../domain/errors.js';
import type { Transaction, TransactionType } from '../domain/transaction.js';
import type { TransactionRepository } from './ports/transaction-repository.js';

export interface IdempotentRequestShape {
  readonly type: TransactionType;
  /**
   * Total credited cents the operation produces, summed across all its legs.
   * For a single-currency movement this equals the amount moved; for a
   * cross-currency exchange it is the source leg plus the converted
   * destination leg. Used only as a replay fingerprint, never as money.
   */
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
