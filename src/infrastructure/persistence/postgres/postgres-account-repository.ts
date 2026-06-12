import type { PoolClient } from 'pg';
import type { AccountRepository } from '../../../application/ports/account-repository.js';
import type { Account, AccountKind, AccountStatus } from '../../../domain/account.js';
import { AccountNotFoundError } from '../../../domain/errors.js';

interface AccountRow {
  id: string;
  owner_name: string;
  currency: string;
  kind: AccountKind;
  status: AccountStatus;
  created_at: Date;
}

export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly client: PoolClient) {}

  async create(account: Account): Promise<void> {
    await this.client.query(
      `INSERT INTO accounts (id, owner_name, currency, kind, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        account.id,
        account.ownerName,
        account.currency,
        account.kind,
        account.status,
        account.createdAt,
      ],
    );
  }

  async findById(id: string): Promise<Account | null> {
    const result = await this.client.query<AccountRow>('SELECT * FROM accounts WHERE id = $1', [
      id,
    ]);
    return result.rows[0] ? toAccount(result.rows[0]) : null;
  }

  async updateStatus(id: string, status: AccountStatus): Promise<void> {
    const result = await this.client.query('UPDATE accounts SET status = $2 WHERE id = $1', [
      id,
      status,
    ]);
    if (result.rowCount === 0) {
      throw new AccountNotFoundError(id);
    }
  }

  async findSystemAccount(currency: string): Promise<Account | null> {
    const result = await this.client.query<AccountRow>(
      "SELECT * FROM accounts WHERE kind = 'SYSTEM' AND currency = $1",
      [currency],
    );
    return result.rows[0] ? toAccount(result.rows[0]) : null;
  }

  async lockForUpdate(ids: readonly string[]): Promise<Account[]> {
    // Ascending id order makes lock acquisition deterministic across
    // concurrent transactions, which rules out deadlocks between transfers
    // that touch the same accounts in opposite directions.
    const result = await this.client.query<AccountRow>(
      'SELECT * FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [[...ids].sort()],
    );
    return result.rows.map(toAccount);
  }
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    ownerName: row.owner_name,
    currency: row.currency,
    kind: row.kind,
    status: row.status,
    createdAt: row.created_at,
  };
}
