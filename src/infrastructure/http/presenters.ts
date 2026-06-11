import type { Account } from '../../domain/account.js';
import type { LedgerEntry, Transaction } from '../../domain/transaction.js';

export function presentAccount(account: Account) {
  return {
    id: account.id,
    ownerName: account.ownerName,
    currency: account.currency,
    status: account.status,
    createdAt: account.createdAt.toISOString(),
  };
}

export function presentEntry(entry: LedgerEntry) {
  return {
    id: entry.id,
    transactionId: entry.transactionId,
    accountId: entry.accountId,
    direction: entry.direction,
    amountCents: entry.amountCents,
    currency: entry.currency,
    createdAt: entry.createdAt.toISOString(),
  };
}

export function presentTransaction(transaction: Transaction) {
  return {
    id: transaction.id,
    type: transaction.type,
    idempotencyKey: transaction.idempotencyKey,
    createdAt: transaction.createdAt.toISOString(),
    entries: transaction.entries.map(presentEntry),
  };
}
