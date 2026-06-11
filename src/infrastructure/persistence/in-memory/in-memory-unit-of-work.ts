import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../../application/ports/unit-of-work.js';
import { InMemoryAccountRepository } from './in-memory-account-repository.js';
import { InMemoryStore } from './in-memory-store.js';
import { InMemoryTransactionRepository } from './in-memory-transaction-repository.js';

/**
 * Mirrors the transactional guarantees of the PostgreSQL unit of work in
 * memory: work units run one at a time and state rolls back on failure, so
 * use-case tests exercise the exact semantics they get in production.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  private readonly repos: TransactionalRepositories;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: InMemoryStore = new InMemoryStore()) {
    this.repos = {
      accounts: new InMemoryAccountRepository(store),
      transactions: new InMemoryTransactionRepository(store),
    };
  }

  async run<T>(work: (repos: TransactionalRepositories) => Promise<T>): Promise<T> {
    // A previously failed unit must not poison the queue, hence both branches.
    const execution = this.tail.then(
      () => this.executeAtomically(work),
      () => this.executeAtomically(work),
    );
    this.tail = execution.catch(() => undefined);
    return execution;
  }

  private async executeAtomically<T>(
    work: (repos: TransactionalRepositories) => Promise<T>,
  ): Promise<T> {
    const snapshot = this.store.snapshot();
    try {
      return await work(this.repos);
    } catch (error) {
      this.store.restore(snapshot);
      throw error;
    }
  }
}
