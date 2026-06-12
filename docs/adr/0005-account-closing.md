# ADR-0005: Account closing requires a zero balance

- Status: accepted
- Date: 2026-06-12

## Context

Accounts have a lifecycle. An account holder eventually wants to close their
account, and the service needs a terminal state that stops further money
movement. But a ledger must never strand value: closing an account that still
holds funds would either lose that money or leave it unreachable.

## Decision

`CloseAccount` transitions an account from `ACTIVE` to `CLOSED`, subject to
three rules enforced inside one unit of work:

1. **Zero balance.** The account's balance — derived from its entries — must be
   exactly zero. A non-zero balance is rejected with `ACCOUNT_NOT_EMPTY` (409).
   The row is locked before the balance is read, so a concurrent deposit cannot
   slip between the check and the close.
2. **SYSTEM accounts are protected.** Treasury counterparties underpin every
   deposit and withdrawal; closing one would break the ledger. Attempting it is
   rejected with `SYSTEM_ACCOUNT_PROTECTED` (403).
3. **Idempotent.** Closing an already-closed account is a no-op that returns the
   account, so client retries are safe.

A `CLOSED` account fails `isTransactable`, so the existing guards reject any
later deposit, withdrawal or transfer with `ACCOUNT_CLOSED` — no new checks were
needed on the movement paths.

## Consequences

- Closing is a status flip, not a deletion: the entries (and thus the audit
  trail) remain forever. Balances of closed accounts still read as zero.
- Reopening is intentionally not modelled; a new account is the clean path.
- The status lives on the account row, so the constraint is a cheap `UPDATE`
  with no schema change beyond the `status` column that already existed.
