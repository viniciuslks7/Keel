# ADR-0006: Domain events are published through a transactional outbox

- Status: accepted
- Date: 2026-06-12

## Context

Downstream consumers — notifications, analytics, an audit pipeline — need to
react to ledger facts such as an account opening or funds moving. The naive
approach publishes to a broker inside the use case, right after the database
write. That splits the commit into two systems with no shared transaction: if
the process dies between the database commit and the publish, the event is lost;
if it dies between the publish and the commit, a consumer reacts to a change
that was rolled back. Neither is acceptable for a ledger.

## Decision

Use cases never talk to a broker. Instead they append a `DomainEvent` to an
**outbox** repository inside the same unit of work as the ledger change. Because
`outbox.add` and the transaction `save` share one transaction, an event exists
**if and only if** its change committed — no lost events, no phantom events.

A separate `OutboxRelay` drains the outbox out of band:

1. Read a batch of unpublished events (one unit of work).
2. Hand them to an `EventPublisher` — the external side effect.
3. Mark them published (a second unit of work).

Publishing sits *between* two transactions rather than inside one, which makes
delivery **at-least-once**: a crash after publishing but before marking simply
re-delivers on the next drain. Consumers must therefore be idempotent on
`event.id`. We chose at-least-once over exactly-once deliberately — exactly-once
across a database and a broker requires distributed transactions we don't want.

The `EventPublisher` port keeps the broker out of the core: the default
`LoggingEventPublisher` writes to the structured log, and swapping in Kafka, SNS
or a webhook is a one-class change with no use-case edits.

## Consequences

- The outbox is append-only; published rows are kept (not deleted) so the table
  doubles as an event log. A retention job can prune old published rows later.
- Ordering is per-drain, not globally guaranteed; consumers that need ordering
  must key off `occurredAt` or the transaction id carried on each event.
- Every money-moving use case gained an `IdGenerator` and `Clock` dependency to
  stamp `event.id` and `occurredAt`, mirroring how transactions are already
  stamped.
- The relay is not yet scheduled by the runtime; wiring it to a timer (and
  emitting OpenTelemetry spans around each drain) is the natural next step.
