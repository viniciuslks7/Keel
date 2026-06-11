import type {
  StatementPage,
  StatementQuery,
  TransactionRepository,
} from '../../../application/ports/transaction-repository.js';
import type { LedgerEntry, Transaction } from '../../../domain/transaction.js';
import { decodeCursor, encodeCursor } from '../cursor.js';

export class InMemoryTransactionRepository implements TransactionRepository {
  constructor(private readonly store: { transactions: Transaction[] }) {}

  async save(transaction: Transaction): Promise<void> {
    if (
      transaction.idempotencyKey !== null &&
      this.store.transactions.some((t) => t.idempotencyKey === transaction.idempotencyKey)
    ) {
      throw new Error(`duplicate idempotency key: ${transaction.idempotencyKey}`);
    }
    this.store.transactions.push(transaction);
  }

  async findByIdempotencyKey(key: string): Promise<Transaction | null> {
    return this.store.transactions.find((t) => t.idempotencyKey === key) ?? null;
  }

  async balanceOf(accountId: string): Promise<number> {
    let balance = 0;
    for (const transaction of this.store.transactions) {
      for (const entry of transaction.entries) {
        if (entry.accountId === accountId) {
          balance += entry.direction === 'CREDIT' ? entry.amountCents : -entry.amountCents;
        }
      }
    }
    return balance;
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
