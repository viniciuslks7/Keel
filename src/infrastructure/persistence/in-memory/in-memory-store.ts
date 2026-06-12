import type { Account } from '../../../domain/account.js';
import type { DomainEvent } from '../../../domain/events.js';
import type { Transaction } from '../../../domain/transaction.js';

export interface OutboxRecord {
  readonly event: DomainEvent;
  published: boolean;
}

interface Snapshot {
  accounts: Map<string, Account>;
  transactions: Transaction[];
  outbox: OutboxRecord[];
  balances: Map<string, number>;
}

/**
 * Shared mutable state behind the in-memory adapters. Kept as a plain data
 * holder so the unit of work can snapshot and restore it atomically.
 */
export class InMemoryStore {
  accounts = new Map<string, Account>();
  transactions: Transaction[] = [];
  outbox: OutboxRecord[] = [];
  // Materialized running balance per account, kept in step with `transactions`
  // by the transaction repository (see ADR-0008). A derived cache, not a second
  // source of truth: it always equals the signed sum of an account's entries.
  balances = new Map<string, number>();

  snapshot(): Snapshot {
    return {
      accounts: new Map(this.accounts),
      transactions: [...this.transactions],
      outbox: this.outbox.map((record) => ({ ...record })),
      balances: new Map(this.balances),
    };
  }

  restore(snapshot: Snapshot): void {
    this.accounts = snapshot.accounts;
    this.transactions = snapshot.transactions;
    this.outbox = snapshot.outbox;
    this.balances = snapshot.balances;
  }
}
