import type { Account } from '../../domain/account.js';
import { AccountNotFoundError } from '../../domain/errors.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export class GetAccount {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(accountId: string): Promise<Account> {
    return this.uow.run(async ({ accounts }) => {
      const account = await accounts.findById(accountId);
      if (!account) {
        throw new AccountNotFoundError(accountId);
      }
      return account;
    });
  }
}
