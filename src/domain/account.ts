export type AccountStatus = 'ACTIVE' | 'CLOSED';

/**
 * SYSTEM accounts are internal treasury counterparties: every deposit or
 * withdrawal is double-entry posted against the SYSTEM account of the same
 * currency, so the ledger always balances even at the boundary with the
 * outside world.
 */
export type AccountKind = 'CUSTOMER' | 'SYSTEM';

export interface Account {
  readonly id: string;
  readonly ownerName: string;
  readonly currency: string;
  readonly kind: AccountKind;
  readonly status: AccountStatus;
  readonly createdAt: Date;
}

export function isTransactable(account: Account): boolean {
  return account.status === 'ACTIVE';
}

export function isSystem(account: Account): boolean {
  return account.kind === 'SYSTEM';
}
