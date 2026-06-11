# ADR-0001: Double-entry ledger instead of a mutable balance column

- Status: accepted
- Date: 2026-06-10

## Context

The naive way to model a wallet is a `balance` column that gets incremented
and decremented. It is simple, but it has two structural problems:

1. **No audit trail.** When the balance is wrong (and at some point it will
   be), there is nothing to reconcile against.
2. **Lost-update hazards.** Read-modify-write on a single column invites
   races that silently create or destroy money.

## Decision

Keel stores **append-only ledger entries** and derives every balance from
them. Each transaction posts at least one DEBIT and one CREDIT that must sum
to zero, enforced in a single domain function (`postTransaction`) that is the
only code path able to create entries.

Movements against the outside world (deposits, withdrawals) are posted
against a per-currency **SYSTEM treasury account**, so even boundary
operations are balanced: at any instant, the sum of all customer balances
equals what the treasury owes the external world.

## Consequences

- Balances are a `SUM(...)` aggregation, never a stored counter, so they can
  never drift from the entries.
- Auditability comes for free: the statement endpoint is just a paginated
  read of the same rows used for balances.
- Balance reads are O(entries-per-account). If an account grows hot, the
  standard mitigation is periodic snapshot rows (materialized running
  balances), which can be added without changing the write model.
