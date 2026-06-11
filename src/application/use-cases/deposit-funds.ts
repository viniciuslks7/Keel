import { InvalidAmountError } from '../../domain/errors.js';
import { postTransaction } from '../../domain/ledger.js';
import { Money } from '../../domain/money.js';
import type { Transaction } from '../../domain/transaction.js';
import { requireActiveAccount, requireSystemAccount } from '../account-guards.js';
import { findReplayedTransaction } from '../idempotency.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface DepositFundsInput {
  readonly accountId: string;
  readonly amountCents: number;
  readonly idempotencyKey?: string;
}

export class DepositFunds {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: DepositFundsInput): Promise<Transaction> {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      throw new InvalidAmountError('deposit amount must be a positive integer of cents');
    }

    return this.uow.run(async ({ accounts, transactions }) => {
      const replayed = await findReplayedTransaction(transactions, input.idempotencyKey, {
        type: 'DEPOSIT',
        amountCents: input.amountCents,
        accountIds: [input.accountId],
      });
      if (replayed) {
        return replayed;
      }

      const account = await requireActiveAccount(accounts, input.accountId);
      const system = await requireSystemAccount(accounts, account.currency);
      await accounts.lockForUpdate([account.id, system.id]);

      const amount = Money.of(input.amountCents, account.currency);
      const transaction = postTransaction({
        id: this.ids.next(),
        type: 'DEPOSIT',
        idempotencyKey: input.idempotencyKey ?? null,
        legs: [
          { accountId: system.id, direction: 'DEBIT', amount },
          { accountId: account.id, direction: 'CREDIT', amount },
        ],
        entryIds: [this.ids.next(), this.ids.next()],
        createdAt: this.clock.now(),
      });

      await transactions.save(transaction);
      return transaction;
    });
  }
}
