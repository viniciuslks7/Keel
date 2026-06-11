import { InsufficientFundsError, InvalidAmountError } from '../../domain/errors.js';
import { postTransaction } from '../../domain/ledger.js';
import { Money } from '../../domain/money.js';
import type { Transaction } from '../../domain/transaction.js';
import { requireActiveAccount, requireSystemAccount } from '../account-guards.js';
import { findReplayedTransaction } from '../idempotency.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface WithdrawFundsInput {
  readonly accountId: string;
  readonly amountCents: number;
  readonly idempotencyKey?: string;
}

export class WithdrawFunds {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: WithdrawFundsInput): Promise<Transaction> {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      throw new InvalidAmountError('withdrawal amount must be a positive integer of cents');
    }

    return this.uow.run(async ({ accounts, transactions }) => {
      const replayed = await findReplayedTransaction(transactions, input.idempotencyKey, {
        type: 'WITHDRAWAL',
        amountCents: input.amountCents,
        accountIds: [input.accountId],
      });
      if (replayed) {
        return replayed;
      }

      const account = await requireActiveAccount(accounts, input.accountId);
      const system = await requireSystemAccount(accounts, account.currency);
      await accounts.lockForUpdate([account.id, system.id]);

      // The balance read must happen after the lock, otherwise two parallel
      // withdrawals could both observe enough funds and overdraw the account.
      const balanceCents = await transactions.balanceOf(account.id);
      if (balanceCents < input.amountCents) {
        throw new InsufficientFundsError(account.id, balanceCents, input.amountCents);
      }

      const amount = Money.of(input.amountCents, account.currency);
      const transaction = postTransaction({
        id: this.ids.next(),
        type: 'WITHDRAWAL',
        idempotencyKey: input.idempotencyKey ?? null,
        legs: [
          { accountId: account.id, direction: 'DEBIT', amount },
          { accountId: system.id, direction: 'CREDIT', amount },
        ],
        entryIds: [this.ids.next(), this.ids.next()],
        createdAt: this.clock.now(),
      });

      await transactions.save(transaction);
      return transaction;
    });
  }
}
