-- Transactional outbox. Events are inserted in the same transaction as the
-- ledger change that produced them; a relay later publishes the unpublished
-- rows and stamps published_at (see ADR-0006).

CREATE TABLE outbox (
  id            UUID PRIMARY KEY,
  type          TEXT NOT NULL,
  payload       JSONB NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  published_at  TIMESTAMPTZ
);

-- Partial index over just the backlog keeps the relay's poll cheap regardless
-- of how many events have already been published.
CREATE INDEX outbox_unpublished
  ON outbox (occurred_at, id)
  WHERE published_at IS NULL;
