import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureSystemAccounts } from '../../src/application/bootstrap.js';
import { CloseAccount } from '../../src/application/use-cases/close-account.js';
import { CreateAccount } from '../../src/application/use-cases/create-account.js';
import { DepositFunds } from '../../src/application/use-cases/deposit-funds.js';
import { GetBalance } from '../../src/application/use-cases/get-balance.js';
import { TransferFunds } from '../../src/application/use-cases/transfer-funds.js';
import { WithdrawFunds } from '../../src/application/use-cases/withdraw-funds.js';
import {
  AccountClosedError,
  IdempotencyConflictError,
  InsufficientFundsError,
  InvalidMoneyError,
} from '../../src/domain/errors.js';
import { PostgresUnitOfWork } from '../../src/infrastructure/persistence/postgres/postgres-unit-of-work.js';
import { RandomIds, TickingClock } from '../helpers/fixed-deps.js';

// Explicit test URL only. Never connects to the application's DATABASE_URL.
const databaseUrl = process.env.KEEL_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('PostgreSQL integration and concurrency', () => {
  const schema = `keel_test_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let uow: PostgresUnitOfWork;
  let create: CreateAccount;
  let deposit: DepositFunds;
  let withdraw: WithdrawFunds;
  let transfer: TransferFunds;
  let close: CloseAccount;
  let balance: GetBalance;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 12,
      options: `-c search_path=${schema}`,
      application_name: schema,
    });
    const migrations = new URL('../../migrations/', import.meta.url);
    for (const file of (await readdir(migrations)).filter((file) => file.endsWith('.sql')).sort()) {
      await pool.query(await readFile(new URL(file, migrations), 'utf8'));
    }
    uow = new PostgresUnitOfWork(pool);
  }, 20000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE account_balances, ledger_entries, transactions, outbox, accounts CASCADE',
    );
    const ids = new RandomIds();
    const clock = new TickingClock();
    await ensureSystemAccounts(uow, ids, clock, ['BRL', 'USD']);
    create = new CreateAccount(uow, ids, clock);
    deposit = new DepositFunds(uow, ids, clock);
    withdraw = new WithdrawFunds(uow, ids, clock);
    transfer = new TransferFunds(uow, ids, clock);
    close = new CloseAccount(uow, ids, clock);
    balance = new GetBalance(uow);
  });

  const account = async (currency = 'BRL') =>
    (await create.execute({ ownerName: 'Fictional integration account', currency })).id;
  async function waitForBlocked(count: number): Promise<void> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await admin.query<{ count: string }>(
        "SELECT count(*) FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
        [schema],
      );
      if (Number(result.rows[0]?.count) >= count) return;
      await setTimeout(20);
    }
    throw new Error(`Expected ${count} operations waiting on real PostgreSQL locks`);
  }

  it('simultaneous identical keys return one committed transaction and one outbox event', async () => {
    const id = await account();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        deposit.execute({ accountId: id, amountCents: 100, idempotencyKey: 'same-key' }),
      ),
    );
    expect(new Set(results.map((tx) => tx.id)).size).toBe(1);
    expect((await balance.execute(id)).balanceCents).toBe(100);
    expect((await pool.query('SELECT * FROM transactions')).rowCount).toBe(1);
    expect((await pool.query("SELECT * FROM outbox WHERE type = 'FundsDeposited'")).rowCount).toBe(
      1,
    );
  });

  it('serializes a reused key across disjoint currencies and rejects the divergent request', async () => {
    const a = await account('BRL');
    const b = await account('USD');
    const results = await Promise.allSettled(
      [a, b].map((id) =>
        deposit.execute({ accountId: id, amountCents: 100, idempotencyKey: 'global-key' }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toBeInstanceOf(
      IdempotencyConflictError,
    );
    expect((await balance.execute(a)).balanceCents + (await balance.execute(b)).balanceCents).toBe(
      100,
    );
    expect((await pool.query('SELECT * FROM transactions')).rowCount).toBe(1);
  });

  it('parallel withdrawals cannot overdraw or unbalance the ledger', async () => {
    const id = await account();
    await deposit.execute({ accountId: id, amountCents: 1000 });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => withdraw.execute({ accountId: id, amountCents: 400 })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    for (const result of results)
      if (result.status === 'rejected')
        expect(result.reason).toBeInstanceOf(InsufficientFundsError);
    expect((await balance.execute(id)).balanceCents).toBe(200);
    const net = await pool.query<{ net: string }>(
      "SELECT sum(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE -amount_cents END) AS net FROM ledger_entries",
    );
    expect(net.rows[0]?.net).toBe('0');
  });

  it('opposing transfers finish without deadlock and preserve the balances', async () => {
    const a = await account();
    const b = await account();
    await deposit.execute({ accountId: a, amountCents: 1000 });
    await deposit.execute({ accountId: b, amountCents: 1000 });
    await Promise.all(
      Array.from({ length: 10 }, () => [
        transfer.execute({ fromAccountId: a, toAccountId: b, amountCents: 10 }),
        transfer.execute({ fromAccountId: b, toAccountId: a, amountCents: 10 }),
      ]).flat(),
    );
    expect((await balance.execute(a)).balanceCents).toBe(1000);
    expect((await balance.execute(b)).balanceCents).toBe(1000);
    expect((await pool.query("SELECT * FROM transactions WHERE type = 'TRANSFER'")).rowCount).toBe(
      20,
    );
  }, 15000);

  it('revalidates closed status when a close commits while a deposit is waiting', async () => {
    const id = await account();
    const blocker = await pool.connect();
    let outcome: Promise<unknown> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [id]);
      outcome = deposit.execute({ accountId: id, amountCents: 100 }).catch((error) => error);
      await waitForBlocked(1);
      await blocker.query("UPDATE accounts SET status = 'CLOSED' WHERE id = $1", [id]);
      await blocker.query('COMMIT');
      expect(await outcome).toBeInstanceOf(AccountClosedError);
      expect((await balance.execute(id)).balanceCents).toBe(0);
      expect((await pool.query('SELECT * FROM transactions')).rowCount).toBe(0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      if (outcome) await outcome;
    }
  }, 15000);

  it('concurrent closes emit AccountClosed once after waiting for a held row lock', async () => {
    const id = await account();
    const blocker = await pool.connect();
    let outcomes: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [id]);
      outcomes = Promise.allSettled([close.execute(id), close.execute(id)]);
      await waitForBlocked(2);
      await blocker.query('COMMIT');
      expect((await outcomes).every((result) => result.status === 'fulfilled')).toBe(true);
      expect((await pool.query("SELECT * FROM outbox WHERE type = 'AccountClosed'")).rowCount).toBe(
        1,
      );
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      if (outcomes) await outcomes;
    }
  }, 15000);

  it('overflow rolls back entries, balances, idempotency key and outbox', async () => {
    const id = await account();
    await deposit.execute({ accountId: id, amountCents: Number.MAX_SAFE_INTEGER });
    await expect(
      deposit.execute({ accountId: id, amountCents: 1, idempotencyKey: 'overflow' }),
    ).rejects.toThrow(InvalidMoneyError);
    expect((await balance.execute(id)).balanceCents).toBe(Number.MAX_SAFE_INTEGER);
    expect((await pool.query('SELECT * FROM transactions')).rowCount).toBe(1);
    expect((await pool.query('SELECT * FROM ledger_entries')).rowCount).toBe(2);
    expect((await pool.query("SELECT * FROM outbox WHERE type = 'FundsDeposited'")).rowCount).toBe(
      1,
    );
    expect(
      await uow.run(({ transactions }) => transactions.findByIdempotencyKey('overflow')),
    ).toBeNull();
  });
});
