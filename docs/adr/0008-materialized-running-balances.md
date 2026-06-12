# ADR-0008: Balances are read from a materialized running total

- Status: accepted
- Date: 2026-06-12

## Context

ADR-0001 makes ledger entries the single source of truth and derives every
balance by summing them. That is correct but it scales with history: a hot
account — a treasury counterparty, a busy merchant — accumulates millions of
entries, and `balanceOf` then sums all of them on every read. The balance check
inside `WithdrawFunds`/`TransferFunds` sits on the write path, so this cost is
paid on each money movement, not just on dashboard reads.

## Decision

Keep a materialized running balance per account in an `account_balances` table
(`account_id` → `balance_cents`), and read `balanceOf` straight off it in O(1).
The table is a **derived cache, not a second source of truth**: ledger_entries
stay append-only and authoritative, and every balance row is exactly the signed
sum of its account's entries.

Consistency is structural, not best-effort:

- The transaction repository folds each transaction's entries into the balance
  with an `INSERT ... ON CONFLICT DO UPDATE SET balance = balance + delta`,
  **inside the same database transaction** as the entry writes. The cache
  therefore commits or rolls back atomically with the entries — it cannot drift.
- Every use case that writes entries already takes a `FOR UPDATE` lock on each
  account it touches (ADR-0004). That lock serializes concurrent writers to the
  same balance row, so the read-modify-write of the running total is safe.
- The migration backfills the table from `ledger_entries` with a `GROUP BY` sum,
  which doubles as the proof that the cache is reconstructable: it can be dropped
  and rebuilt from the entries at any time.

The in-memory adapter mirrors this with a balance map kept in step on `save` and
rolled back with the rest of the store, so use-case tests exercise the same
semantics. A test recomputes balances independently from the statement (the path
that never reads the cache) and asserts the two agree after every operation.

## Consequences

- Reads drop from O(entries) to O(1); the cost moves to a single extra upsert
  per touched account on the write path, under a lock already being held.
- The invariant "balance == sum of entries" now has two enforcers — the writer
  and the reconstruction job/backfill — and the test suite pins it down.
- The running total is the natural foundation for the next roadmap item,
  multi-currency transfers: an FX leg simply credits and debits two balances.
- Should a balance ever be suspected of drift (a bug, a manual edit), the fix is
  a rebuild from entries, never a manual correction of the cache.
