import type { Account } from '../../domain/account.js';
import { Money } from '../../domain/money.js';
import { requireSystemAccount } from '../account-guards.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface CreateAccountInput {
  readonly ownerName: string;
  readonly currency: string;
}

export class CreateAccount {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: CreateAccountInput): Promise<Account> {
    // Money.of validates the currency code; the zero amount is irrelevant.
    Money.of(0, input.currency);

    return this.uow.run(async ({ accounts, outbox }) => {
      await requireSystemAccount(accounts, input.currency);

      const account: Account = {
        id: this.ids.next(),
        ownerName: input.ownerName,
        currency: input.currency,
        kind: 'CUSTOMER',
        status: 'ACTIVE',
        createdAt: this.clock.now(),
      };
      await accounts.create(account);
      await outbox.add({
        id: this.ids.next(),
        occurredAt: this.clock.now(),
        type: 'AccountOpened',
        accountId: account.id,
        ownerName: account.ownerName,
        currency: account.currency,
      });
      return account;
    });
  }
}
