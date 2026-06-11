# ADR-0004: Idempotency keys and deterministic lock ordering

- Status: accepted
- Date: 2026-06-10

## Context

Money movement endpoints face two concurrency realities:

1. Clients retry. A timeout after the server committed means a blind retry
   would double-post.
2. Requests race. Two parallel withdrawals can both observe sufficient funds
   and overdraw the account; two opposing transfers can deadlock.

## Decision

**Idempotency:** mutating endpoints accept an `Idempotency-Key` header. The
key is stored on the transaction row under a unique constraint. A replay with
an identical payload returns the original transaction; the same key with a
different payload is rejected with `409 Conflict`. The check runs inside the
same database transaction as the posting, so the unique constraint is the
final arbiter even under races.

**Locking:** every posting locks the involved account rows with
`SELECT ... FOR UPDATE` **in ascending id order**. Balance checks happen
after the lock. Deterministic ordering means two transactions touching the
same accounts always acquire locks in the same sequence — deadlock-free by
construction.

## Consequences

- Overdrafts are impossible regardless of concurrency (covered by a test
  that fires five parallel withdrawals at one account).
- Lock granularity is per-account, so unrelated accounts never contend.
- The in-memory adapter mirrors these semantics by serializing units of work,
  keeping the test environment honest.
