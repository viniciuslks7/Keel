-- Materialized running balance per account. This is a derived cache, not a new
-- source of truth: ledger_entries remain append-only and authoritative (ADR-0001),
-- and every row here equals the signed sum of its account's entries. The
-- transaction repository keeps it in step inside the same transaction as the
-- entry writes, so it can never drift (see ADR-0008).

CREATE TABLE account_balances (
  account_id    UUID PRIMARY KEY REFERENCES accounts (id),
  balance_cents BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill from the authoritative entries. Proves the cache is reconstructable:
-- it can be dropped and rebuilt from ledger_entries at any time.
INSERT INTO account_balances (account_id, balance_cents, updated_at)
SELECT account_id,
       SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE -amount_cents END),
       now()
FROM ledger_entries
GROUP BY account_id;
