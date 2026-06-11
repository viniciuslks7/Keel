import { AccountNotFoundError } from '../../domain/errors.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface BalanceView {
  readonly accountId: string;
  readonly balanceCents: number;
  readonly currency: string;
}

export class GetBalance {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(accountId: string): Promise<BalanceView> {
    return this.uow.run(async ({ accounts, transactions }) => {
      const account = await accounts.findById(accountId);
      if (!account) {
        throw new AccountNotFoundError(accountId);
      }
      const balanceCents = await transactions.balanceOf(accountId);
      return { accountId, balanceCents, currency: account.currency };
    });
  }
}
