import {
  CurrencyMismatchError,
  InsufficientFundsError,
  InvalidAmountError,
  SelfTransferError,
} from '../../domain/errors.js';
import { postTransaction } from '../../domain/ledger.js';
import { Money } from '../../domain/money.js';
import type { Transaction } from '../../domain/transaction.js';
import { requireActiveAccount } from '../account-guards.js';
import { findReplayedTransaction } from '../idempotency.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface TransferFundsInput {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amountCents: number;
  readonly idempotencyKey?: string;
}

export class TransferFunds {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: TransferFundsInput): Promise<Transaction> {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      throw new InvalidAmountError('transfer amount must be a positive integer of cents');
    }
    if (input.fromAccountId === input.toAccountId) {
      throw new SelfTransferError();
    }

    return this.uow.run(async ({ accounts, transactions }) => {
      const replayed = await findReplayedTransaction(transactions, input.idempotencyKey, {
        type: 'TRANSFER',
        amountCents: input.amountCents,
        accountIds: [input.fromAccountId, input.toAccountId],
      });
      if (replayed) {
        return replayed;
      }

      const source = await requireActiveAccount(accounts, input.fromAccountId);
      const destination = await requireActiveAccount(accounts, input.toAccountId);
      if (source.currency !== destination.currency) {
        throw new CurrencyMismatchError(
          `cannot transfer between ${source.currency} and ${destination.currency} accounts`,
        );
      }

      await accounts.lockForUpdate([source.id, destination.id]);

      const balanceCents = await transactions.balanceOf(source.id);
      if (balanceCents < input.amountCents) {
        throw new InsufficientFundsError(source.id, balanceCents, input.amountCents);
      }

      const amount = Money.of(input.amountCents, source.currency);
      const transaction = postTransaction({
        id: this.ids.next(),
        type: 'TRANSFER',
        idempotencyKey: input.idempotencyKey ?? null,
        legs: [
          { accountId: source.id, direction: 'DEBIT', amount },
          { accountId: destination.id, direction: 'CREDIT', amount },
        ],
        entryIds: [this.ids.next(), this.ids.next()],
        createdAt: this.clock.now(),
      });

      await transactions.save(transaction);
      return transaction;
    });
  }
}
