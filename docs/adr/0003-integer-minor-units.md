# ADR-0003: Money as integer minor units, never floats

- Status: accepted
- Date: 2026-06-10

## Context

IEEE 754 cannot represent 0.1 exactly; accumulating floating-point money
produces off-by-a-cent bugs that are notoriously hard to detect because they
look correct in most cases.

## Decision

All amounts are **integers of minor units** ("cents") wrapped in the `Money`
value object, which rejects non-integers and unsafe integers at construction.
The API speaks `amountCents`; the database stores `BIGINT`.

`node-postgres` returns `BIGINT` as strings to avoid silent precision loss —
repositories parse them explicitly at the boundary.

## Consequences

- Arithmetic is exact and `Money` makes cross-currency operations a type
  error rather than a runtime surprise.
- Display formatting (R$ 10,50) is a client concern; the service never deals
  in decimal strings.
- Number.MAX_SAFE_INTEGER cents ≈ 90 trillion in major units, far beyond the
  domain's range; the guard in `Money.of` makes the limit explicit anyway.
