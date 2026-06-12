/**
 * Domain events describe facts that have already happened in the ledger. They
 * are written to the outbox inside the same unit of work as the change that
 * produced them, so an event exists if and only if its transaction committed
 * (see ADR-0006).
 */
export interface EventEnvelope {
  readonly id: string;
  readonly occurredAt: Date;
}

export type DomainEvent = EventEnvelope &
  (
    | {
        readonly type: 'AccountOpened';
        readonly accountId: string;
        readonly ownerName: string;
        readonly currency: string;
      }
    | { readonly type: 'AccountClosed'; readonly accountId: string }
    | {
        readonly type: 'FundsDeposited';
        readonly accountId: string;
        readonly amountCents: number;
        readonly currency: string;
        readonly transactionId: string;
      }
    | {
        readonly type: 'FundsWithdrawn';
        readonly accountId: string;
        readonly amountCents: number;
        readonly currency: string;
        readonly transactionId: string;
      }
    | {
        readonly type: 'FundsTransferred';
        readonly fromAccountId: string;
        readonly toAccountId: string;
        readonly amountCents: number;
        readonly currency: string;
        readonly transactionId: string;
      }
    | {
        readonly type: 'FundsExchanged';
        readonly fromAccountId: string;
        readonly toAccountId: string;
        readonly fromAmountCents: number;
        readonly fromCurrency: string;
        readonly toAmountCents: number;
        readonly toCurrency: string;
        readonly rate: number;
        readonly transactionId: string;
      }
  );

export type DomainEventType = DomainEvent['type'];
