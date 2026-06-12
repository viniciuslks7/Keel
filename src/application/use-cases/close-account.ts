import { type Account, isSystem, isTransactable } from '../../domain/account.js';
import {
  AccountNotEmptyError,
  AccountNotFoundError,
  SystemAccountProtectedError,
} from '../../domain/errors.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export class CloseAccount {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(accountId: string): Promise<Account> {
    return this.uow.run(async ({ accounts, transactions }) => {
      const account = await accounts.findById(accountId);
      if (!account) {
        throw new AccountNotFoundError(accountId);
      }
      if (isSystem(account)) {
        throw new SystemAccountProtectedError(accountId);
      }
      // Closing an already-closed account is a no-op, so the operation is safe
      // to retry.
      if (!isTransactable(account)) {
        return account;
      }

      // Lock before the balance read: a concurrent deposit must not slip in
      // between the zero check and the close.
      await accounts.lockForUpdate([accountId]);
      const balanceCents = await transactions.balanceOf(accountId);
      if (balanceCents !== 0) {
        throw new AccountNotEmptyError(accountId, balanceCents);
      }

      await accounts.updateStatus(accountId, 'CLOSED');
      return { ...account, status: 'CLOSED' };
    });
  }
}
