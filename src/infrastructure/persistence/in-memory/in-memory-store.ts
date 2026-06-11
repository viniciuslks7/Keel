import type { Account } from '../../../domain/account.js';
import type { Transaction } from '../../../domain/transaction.js';

/**
 * Shared mutable state behind the in-memory adapters. Kept as a plain data
 * holder so the unit of work can snapshot and restore it atomically.
 */
export class InMemoryStore {
  accounts = new Map<string, Account>();
  transactions: Transaction[] = [];

  snapshot(): { accounts: Map<string, Account>; transactions: Transaction[] } {
    return { accounts: new Map(this.accounts), transactions: [...this.transactions] };
  }

  restore(snapshot: { accounts: Map<string, Account>; transactions: Transaction[] }): void {
    this.accounts = snapshot.accounts;
    this.transactions = snapshot.transactions;
  }
}
