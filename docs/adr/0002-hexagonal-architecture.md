# ADR-0002: Hexagonal architecture (ports & adapters)

- Status: accepted
- Date: 2026-06-10

## Context

A ledger's value is its invariants. Frameworks, drivers and transports change;
"debits equal credits" does not. The architecture should make the invariant
code independent of everything replaceable.

## Decision

Three concentric layers with dependencies pointing strictly inward:

- **`domain/`** — entities, value objects (`Money`) and the posting rules.
  Zero imports from outside the domain.
- **`application/`** — use cases orchestrating the domain through **ports**
  (interfaces): `AccountRepository`, `TransactionRepository`, `UnitOfWork`,
  `Clock`, `IdGenerator`.
- **`infrastructure/`** — adapters implementing the ports: PostgreSQL
  repositories, an in-memory twin for tests, and the Fastify HTTP layer,
  which depends only on use cases.

`src/main.ts` is the composition root — the single file aware of every layer.

## Consequences

- The entire API test suite runs against in-memory adapters in milliseconds,
  with the same transactional semantics as production (the in-memory unit of
  work serializes and rolls back exactly like the SQL one).
- Swapping PostgreSQL for another store means writing three adapter classes;
  no use case changes.
- The cost is more files and explicit wiring. For a money-moving service the
  trade is worth it; for a CRUD prototype it would be overengineering.
