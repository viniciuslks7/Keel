-- Core ledger schema. Entries are append-only: there is no UPDATE or DELETE
-- path for ledger_entries anywhere in the application, and balances are
-- always derived from the entries themselves (see ADR-0001).

CREATE TABLE accounts (
  id          UUID PRIMARY KEY,
  owner_name  TEXT NOT NULL,
  currency    CHAR(3) NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('CUSTOMER', 'SYSTEM')),
  status      TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED')),
  created_at  TIMESTAMPTZ NOT NULL
);

-- Exactly one treasury counterparty per currency.
CREATE UNIQUE INDEX accounts_one_system_per_currency
  ON accounts (currency)
  WHERE kind = 'SYSTEM';

CREATE TABLE transactions (
  id               UUID PRIMARY KEY,
  type             TEXT NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER')),
  idempotency_key  TEXT UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL
);

CREATE TABLE ledger_entries (
  id              UUID PRIMARY KEY,
  transaction_id  UUID NOT NULL REFERENCES transactions (id),
  account_id      UUID NOT NULL REFERENCES accounts (id),
  direction       TEXT NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
  currency        CHAR(3) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL
);

-- Serves balance aggregation and keyset-paginated statements.
CREATE INDEX ledger_entries_account_recency
  ON ledger_entries (account_id, created_at DESC, id DESC);
