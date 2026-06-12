# ADR-0009: Cross-currency transfers balance per currency, bridged by treasuries

- Status: accepted
- Date: 2026-06-12

## Context

Until now a transaction had to be single-currency: `postTransaction` rejected
any posting whose legs did not all share one currency. That kept the balance
rule trivial — total debits equal total credits — but made a transfer between a
BRL account and a USD account impossible to express as one atomic posting. Real
wallets need exactly that: move money from an account in one currency to an
account in another, at an agreed FX rate, without a window where one side has
moved and the other has not.

## Decision

Generalize the ledger invariant from "debits equal credits" to **"debits equal
credits within every currency the transaction touches"**. `postTransaction` now
nets each currency independently and requires every bucket to reach zero. A
single-currency posting is the common case and is unchanged; a cross-currency
posting simply has more than one bucket, each of which must balance on its own.
Money is still never created or destroyed — the guarantee just holds per
currency, which is the only way it can hold when two currencies are involved.

A cross-currency transfer is then four legs, bridged through the existing
per-currency SYSTEM treasuries (the same counterparties used by deposits and
withdrawals):

```
DEBIT  source        (A, fromAmount)   ┐ currency A nets to zero
CREDIT treasury_A    (A, fromAmount)   ┘
DEBIT  treasury_B    (B, toAmount)     ┐ currency B nets to zero
CREDIT destination   (B, toAmount)     ┘
```

The source gives up currency A to treasury_A; treasury_B pays currency B to the
destination. The two treasuries therefore carry the FX position — exactly where
a bank's FX book lives. `toAmount = round(fromAmount * rate)`, with the rate
supplied by the caller: the ledger records the exchange that happened, it does
not source rates. A rate that rounds the destination to zero cents is rejected.

The `ExchangeFunds` use case mirrors `TransferFunds`: it locks all four accounts
(the lock layer already sorts ids, so adding two more cannot deadlock — ADR-0004),
checks the source balance, posts the transaction, and emits a `FundsExchanged`
event through the outbox. It refuses a same-currency pair, pointing callers at
`/transfers`.

## Consequences

- The relaxed invariant is strictly more general: every previously valid posting
  is still valid, and the only new acceptance is a posting that balances each
  currency. The domain test that asserted single-currency now asserts the
  per-currency rule, plus a balanced cross-currency posting succeeds.
- Idempotency fingerprints a replay by a transaction's total credited cents,
  which for an exchange is the source leg plus the converted destination leg;
  the shared helper's contract was made explicit to say so.
- Materialized balances (ADR-0008) needed no change: an exchange is just four
  ordinary entries, folded into four balance rows like any other.
- The FX rate is the caller's input, not a stored rate table. A rates provider
  (and slippage/fees) is a future concern that can sit in front of this use case
  without touching the ledger.
