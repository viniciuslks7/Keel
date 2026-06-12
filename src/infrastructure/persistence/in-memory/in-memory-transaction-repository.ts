import type {
  StatementPage,
  StatementQuery,
  TransactionRepository,
} from '../../../application/ports/transaction-repository.js';
import type { LedgerEntry, Transaction } from '../../../domain/transaction.js';
import { decodeCursor, encodeCursor } from '../cursor.js';

export class InMemoryTransactionRepository implements TransactionRepository {
  constructor(
    private readonly store: { transactions: Transaction[]; balances: Map<string, number> },
  ) {}

  async save(transaction: Transaction): Promise<void> {
    if (
      transaction.idempotencyKey !== null &&
      this.store.transactions.some((t) => t.idempotencyKey === transaction.idempotencyKey)
    ) {
      throw new Error(`duplicate idempotency key: ${transaction.idempotencyKey}`);
    }
    this.store.transactions.push(transaction);
    // Fold the entries into the materialized running balances. This commits or
    // rolls back with `transactions` because the store snapshots both together.
    for (const entry of transaction.entries) {
      const delta = entry.direction === 'CREDIT' ? entry.amountCents : -entry.amountCents;
      this.store.balances.set(
        entry.accountId,
        (this.store.balances.get(entry.accountId) ?? 0) + delta,
      );
    }
  }

  async findByIdempotencyKey(key: string): Promise<Transaction | null> {
    return this.store.transactions.find((t) => t.idempotencyKey === key) ?? null;
  }

  async balanceOf(accountId: string): Promise<number> {
    // O(1) read off the materialized balance instead of summing every entry.
    return this.store.balances.get(accountId) ?? 0;
  }

  async statementOf(query: StatementQuery): Promise<StatementPage> {
    const all: LedgerEntry[] = this.store.transactions
      .flatMap((t) => [...t.entries])
      .filter((entry) => entry.accountId === query.accountId)
      .sort(byNewestFirst);

    const startAfter = query.cursor ? decodeCursor(query.cursor) : null;
    const startIndex = startAfter
      ? all.findIndex(
          (entry) =>
            entry.createdAt.toISOString() === startAfter.createdAt && entry.id === startAfter.id,
        ) + 1
      : 0;

    const page = all.slice(startIndex, startIndex + query.limit);
    const last = page[page.length - 1];
    const hasMore = startIndex + query.limit < all.length;

    return {
      entries: page,
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }
}

function byNewestFirst(a: LedgerEntry, b: LedgerEntry): number {
  const byDate = b.createdAt.getTime() - a.createdAt.getTime();
  return byDate !== 0 ? byDate : b.id.localeCompare(a.id);
}
