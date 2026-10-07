import type { LedgerEntry, Transaction } from '../../domain/transaction.js';

export interface StatementPage {
  readonly entries: readonly LedgerEntry[];
  readonly nextCursor: string | null;
}

export interface StatementQuery {
  readonly accountId: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface TransactionRepository {
  /** Serialize a key within the current unit of work, before replay lookup. */
  lockIdempotencyKey(key: string): Promise<void>;
  save(transaction: Transaction): Promise<void>;
  findByIdempotencyKey(key: string): Promise<Transaction | null>;
  balanceOf(accountId: string): Promise<number>;
  statementOf(query: StatementQuery): Promise<StatementPage>;
}
