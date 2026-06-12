import type { Pool } from 'pg';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../../application/ports/unit-of-work.js';
import { PostgresAccountRepository } from './postgres-account-repository.js';
import { PostgresOutboxRepository } from './postgres-outbox-repository.js';
import { PostgresTransactionRepository } from './postgres-transaction-repository.js';

export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: Pool) {}

  async run<T>(work: (repos: TransactionalRepositories) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const repos: TransactionalRepositories = {
        accounts: new PostgresAccountRepository(client),
        transactions: new PostgresTransactionRepository(client),
        outbox: new PostgresOutboxRepository(client),
      };
      const result = await work(repos);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
