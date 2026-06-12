import type { Account, AccountStatus } from '../../domain/account.js';

export interface AccountRepository {
  create(account: Account): Promise<void>;
  findById(id: string): Promise<Account | null>;
  findSystemAccount(currency: string): Promise<Account | null>;
  updateStatus(id: string, status: AccountStatus): Promise<void>;
  /**
   * Acquires row-level locks on the given accounts for the lifetime of the
   * current unit of work. Implementations must lock in ascending id order so
   * concurrent transfers can never deadlock (see ADR-0004).
   */
  lockForUpdate(ids: readonly string[]): Promise<Account[]>;
}
