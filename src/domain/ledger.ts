import { CurrencyMismatchError, UnbalancedTransactionError } from './errors.js';
import type { Money } from './money.js';
import type { EntryDirection, LedgerEntry, Transaction, TransactionType } from './transaction.js';

export interface PostingLeg {
  readonly accountId: string;
  readonly direction: EntryDirection;
  readonly amount: Money;
}

export interface PostingInput {
  readonly id: string;
  readonly type: TransactionType;
  readonly idempotencyKey: string | null;
  readonly legs: readonly PostingLeg[];
  readonly entryIds: readonly string[];
  readonly createdAt: Date;
}

/**
 * The single place where ledger entries are created. Enforces the two
 * invariants of double-entry bookkeeping: every leg shares one currency and
 * debits equal credits to the cent. Anything that violates this cannot be
 * persisted, by construction.
 */
export function postTransaction(input: PostingInput): Transaction {
  const { id, type, idempotencyKey, legs, entryIds, createdAt } = input;

  if (legs.length < 2) {
    throw new UnbalancedTransactionError('a transaction needs at least one debit and one credit');
  }
  if (entryIds.length !== legs.length) {
    throw new UnbalancedTransactionError('one entry id must be supplied per posting leg');
  }

  const currency = legs[0]?.amount.currency;
  let debits = 0;
  let credits = 0;

  for (const leg of legs) {
    if (leg.amount.currency !== currency) {
      throw new CurrencyMismatchError('all legs of a transaction must share a single currency');
    }
    if (!leg.amount.isPositive()) {
      throw new UnbalancedTransactionError('every posting leg must move a positive amount');
    }
    if (leg.direction === 'DEBIT') {
      debits += leg.amount.cents;
    } else {
      credits += leg.amount.cents;
    }
  }

  if (debits !== credits) {
    throw new UnbalancedTransactionError(
      `debits (${debits}) and credits (${credits}) do not balance`,
    );
  }

  const entries: LedgerEntry[] = legs.map((leg, index) => ({
    id: entryIds[index] as string,
    transactionId: id,
    accountId: leg.accountId,
    direction: leg.direction,
    amountCents: leg.amount.cents,
    currency: leg.amount.currency,
    createdAt,
  }));

  return { id, type, idempotencyKey, entries, createdAt };
}
