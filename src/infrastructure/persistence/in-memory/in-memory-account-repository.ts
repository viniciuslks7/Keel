import type { AccountRepository } from '../../../application/ports/account-repository.js';
import type { Account, AccountStatus } from '../../../domain/account.js';
import { AccountNotFoundError } from '../../../domain/errors.js';
import type { InMemoryStore } from './in-memory-store.js';

export class InMemoryAccountRepository implements AccountRepository {
  constructor(private readonly store: InMemoryStore) {}

  async create(account: Account): Promise<void> {
    this.store.accounts.set(account.id, account);
  }

  async updateStatus(id: string, status: AccountStatus): Promise<void> {
    const account = this.store.accounts.get(id);
    if (!account) {
      throw new AccountNotFoundError(id);
    }
    this.store.accounts.set(id, { ...account, status });
  }

  async findById(id: string): Promise<Account | null> {
    return this.store.accounts.get(id) ?? null;
  }

  async findSystemAccount(currency: string): Promise<Account | null> {
    for (const account of this.store.accounts.values()) {
      if (account.kind === 'SYSTEM' && account.currency === currency) {
        return account;
      }
    }
    return null;
  }

  async lockForUpdate(ids: readonly string[]): Promise<Account[]> {
    // The in-memory unit of work serializes work units, so locking reduces to
    // existence checks while keeping the same contract as the SQL adapter.
    const sorted = [...ids].sort();
    return sorted.map((id) => {
      const account = this.store.accounts.get(id);
      if (!account) {
        throw new AccountNotFoundError(id);
      }
      return account;
    });
  }
}
