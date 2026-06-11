import type { PoolClient } from 'pg';
import type {
  StatementPage,
  StatementQuery,
  TransactionRepository,
} from '../../../application/ports/transaction-repository.js';
import type {
  EntryDirection,
  LedgerEntry,
  Transaction,
  TransactionType,
} from '../../../domain/transaction.js';
import { decodeCursor, encodeCursor } from '../cursor.js';

interface EntryRow {
  id: string;
  transaction_id: string;
  account_id: string;
  direction: EntryDirection;
  amount_cents: string;
  currency: string;
  created_at: Date;
}

interface TransactionRow {
  id: string;
  type: TransactionType;
  idempotency_key: string | null;
  created_at: Date;
}

export class PostgresTransactionRepository implements TransactionRepository {
  constructor(private readonly client: PoolClient) {}

  async save(transaction: Transaction): Promise<void> {
    await this.client.query(
      `INSERT INTO transactions (id, type, idempotency_key, created_at)
       VALUES ($1, $2, $3, $4)`,
      [transaction.id, transaction.type, transaction.idempotencyKey, transaction.createdAt],
    );

    for (const entry of transaction.entries) {
      await this.client.query(
        `INSERT INTO ledger_entries
           (id, transaction_id, account_id, direction, amount_cents, currency, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          entry.id,
          entry.transactionId,
          entry.accountId,
          entry.direction,
          entry.amountCents,
          entry.currency,
          entry.createdAt,
        ],
      );
    }
  }

  async findByIdempotencyKey(key: string): Promise<Transaction | null> {
    const result = await this.client.query<TransactionRow>(
      'SELECT * FROM transactions WHERE idempotency_key = $1',
      [key],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const entries = await this.client.query<EntryRow>(
      'SELECT * FROM ledger_entries WHERE transaction_id = $1 ORDER BY id',
      [row.id],
    );
    return {
      id: row.id,
      type: row.type,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
      entries: entries.rows.map(toEntry),
    };
  }

  async balanceOf(accountId: string): Promise<number> {
    // node-pg returns BIGINT aggregates as strings to avoid silent precision
    // loss, so the sum is parsed explicitly here.
    const result = await this.client.query<{ balance: string }>(
      `SELECT COALESCE(
         SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE -amount_cents END), 0
       ) AS balance
       FROM ledger_entries
       WHERE account_id = $1`,
      [accountId],
    );
    return Number(result.rows[0]?.balance ?? 0);
  }

  async statementOf(query: StatementQuery): Promise<StatementPage> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const params: unknown[] = [query.accountId, query.limit + 1];
    let keysetFilter = '';
    if (cursor) {
      keysetFilter = 'AND (created_at, id) < ($3, $4)';
      params.push(new Date(cursor.createdAt), cursor.id);
    }

    const result = await this.client.query<EntryRow>(
      `SELECT * FROM ledger_entries
       WHERE account_id = $1 ${keysetFilter}
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      params,
    );

    const hasMore = result.rows.length > query.limit;
    const page = result.rows.slice(0, query.limit).map(toEntry);
    const last = page[page.length - 1];

    return {
      entries: page,
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }
}

function toEntry(row: EntryRow): LedgerEntry {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    accountId: row.account_id,
    direction: row.direction,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    createdAt: row.created_at,
  };
}
