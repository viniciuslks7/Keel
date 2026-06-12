import { UnbalancedTransactionError } from './errors.js';
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
 * The single place where ledger entries are created. Enforces the invariant of
 * double-entry bookkeeping: debits equal credits to the cent **within every
 * currency** the transaction touches. A single-currency posting is the common
 * case; a cross-currency one (an FX transfer) balances each currency on its own
 * leg pair, so money is still never created or destroyed (see ADR-0009).
 * Anything that violates this cannot be persisted, by construction.
 */
export function postTransaction(input: PostingInput): Transaction {
  const { id, type, idempotencyKey, legs, entryIds, createdAt } = input;

  if (legs.length < 2) {
    throw new UnbalancedTransactionError('a transaction needs at least one debit and one credit');
  }
  if (entryIds.length !== legs.length) {
    throw new UnbalancedTransactionError('one entry id must be supplied per posting leg');
  }

  // Net debits minus credits per currency; every bucket must end at zero.
  const netByCurrency = new Map<string, number>();
  for (const leg of legs) {
    if (!leg.amount.isPositive()) {
      throw new UnbalancedTransactionError('every posting leg must move a positive amount');
    }
    const signed = leg.direction === 'DEBIT' ? leg.amount.cents : -leg.amount.cents;
    netByCurrency.set(leg.amount.currency, (netByCurrency.get(leg.amount.currency) ?? 0) + signed);
  }

  for (const [currency, net] of netByCurrency) {
    if (net !== 0) {
      throw new UnbalancedTransactionError(
        `${currency} legs do not balance: debits and credits differ by ${net} cents`,
      );
    }
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
