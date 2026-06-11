export type TransactionType = 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER';

export type EntryDirection = 'DEBIT' | 'CREDIT';

export interface LedgerEntry {
  readonly id: string;
  readonly transactionId: string;
  readonly accountId: string;
  readonly direction: EntryDirection;
  readonly amountCents: number;
  readonly currency: string;
  readonly createdAt: Date;
}

export interface Transaction {
  readonly id: string;
  readonly type: TransactionType;
  readonly idempotencyKey: string | null;
  readonly entries: readonly LedgerEntry[];
  readonly createdAt: Date;
}
