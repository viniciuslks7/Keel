import {
  CurrencyMismatchError,
  InsufficientFundsError,
  InvalidAmountError,
  SelfTransferError,
} from '../../domain/errors.js';
import { postTransaction } from '../../domain/ledger.js';
import { Money } from '../../domain/money.js';
import type { Transaction } from '../../domain/transaction.js';
import { requireActiveAccount, requireSystemAccount } from '../account-guards.js';
import { findReplayedTransaction } from '../idempotency.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface ExchangeFundsInput {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  /** Amount debited from the source, in the source account's currency. */
  readonly fromAmountCents: number;
  /** Units of destination currency per unit of source currency. */
  readonly rate: number;
  readonly idempotencyKey?: string;
}

/**
 * Moves money between two accounts that hold different currencies. The source's
 * currency and the destination's currency each balance on their own leg pair,
 * bridged through the per-currency SYSTEM treasuries: the source-currency
 * treasury takes in what the source gives up, and the destination-currency
 * treasury pays out what the destination receives. The two treasuries thus
 * carry the FX position; the ledger stays balanced within each currency
 * (ADR-0009).
 */
export class ExchangeFunds {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: ExchangeFundsInput): Promise<Transaction> {
    if (!Number.isSafeInteger(input.fromAmountCents) || input.fromAmountCents <= 0) {
      throw new InvalidAmountError('exchange amount must be a positive integer of cents');
    }
    if (!Number.isFinite(input.rate) || input.rate <= 0) {
      throw new InvalidAmountError('exchange rate must be a positive, finite number');
    }
    if (input.fromAccountId === input.toAccountId) {
      throw new SelfTransferError();
    }

    const toAmountCents = Math.round(input.fromAmountCents * input.rate);
    if (toAmountCents <= 0) {
      throw new InvalidAmountError('converted amount rounds to zero at the given rate');
    }

    return this.uow.run(async ({ accounts, transactions, outbox }) => {
      const replayed = await findReplayedTransaction(transactions, input.idempotencyKey, {
        type: 'TRANSFER',
        // Fingerprint is the transaction's total credited cents (ADR-0009):
        // the source leg into its treasury plus the converted destination leg.
        amountCents: input.fromAmountCents + toAmountCents,
        accountIds: [input.fromAccountId, input.toAccountId],
      });
      if (replayed) {
        return replayed;
      }

      const source = await requireActiveAccount(accounts, input.fromAccountId);
      const destination = await requireActiveAccount(accounts, input.toAccountId);
      if (source.currency === destination.currency) {
        throw new CurrencyMismatchError(
          'exchange requires two different currencies; use a same-currency transfer instead',
        );
      }

      const sourceTreasury = await requireSystemAccount(accounts, source.currency);
      const destinationTreasury = await requireSystemAccount(accounts, destination.currency);

      await accounts.lockForUpdate([
        source.id,
        destination.id,
        sourceTreasury.id,
        destinationTreasury.id,
      ]);

      const balanceCents = await transactions.balanceOf(source.id);
      if (balanceCents < input.fromAmountCents) {
        throw new InsufficientFundsError(source.id, balanceCents, input.fromAmountCents);
      }

      const fromAmount = Money.of(input.fromAmountCents, source.currency);
      const toAmount = Money.of(toAmountCents, destination.currency);
      const transaction = postTransaction({
        id: this.ids.next(),
        type: 'TRANSFER',
        idempotencyKey: input.idempotencyKey ?? null,
        legs: [
          // Source currency balances: the source gives up funds to its treasury.
          { accountId: source.id, direction: 'DEBIT', amount: fromAmount },
          { accountId: sourceTreasury.id, direction: 'CREDIT', amount: fromAmount },
          // Destination currency balances: its treasury pays the destination.
          { accountId: destinationTreasury.id, direction: 'DEBIT', amount: toAmount },
          { accountId: destination.id, direction: 'CREDIT', amount: toAmount },
        ],
        entryIds: [this.ids.next(), this.ids.next(), this.ids.next(), this.ids.next()],
        createdAt: this.clock.now(),
      });

      await transactions.save(transaction);
      await outbox.add({
        id: this.ids.next(),
        occurredAt: this.clock.now(),
        type: 'FundsExchanged',
        fromAccountId: source.id,
        toAccountId: destination.id,
        fromAmountCents: input.fromAmountCents,
        fromCurrency: source.currency,
        toAmountCents,
        toCurrency: destination.currency,
        rate: input.rate,
        transactionId: transaction.id,
      });
      return transaction;
    });
  }
}
