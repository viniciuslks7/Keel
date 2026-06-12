import type { AccountRepository } from './account-repository.js';
import type { OutboxRepository } from './outbox-repository.js';
import type { TransactionRepository } from './transaction-repository.js';

export interface TransactionalRepositories {
  readonly accounts: AccountRepository;
  readonly transactions: TransactionRepository;
  readonly outbox: OutboxRepository;
}

/**
 * Runs a closure within a single atomic boundary. Everything inside either
 * commits together or rolls back together; repositories handed to the closure
 * are bound to that boundary.
 */
export interface UnitOfWork {
  run<T>(work: (repos: TransactionalRepositories) => Promise<T>): Promise<T>;
}
