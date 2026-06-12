import pg from 'pg';
import { ensureSystemAccounts } from './application/bootstrap.js';
import { OutboxRelay } from './application/outbox-relay.js';
import { CloseAccount } from './application/use-cases/close-account.js';
import { CreateAccount } from './application/use-cases/create-account.js';
import { DepositFunds } from './application/use-cases/deposit-funds.js';
import { GetAccount } from './application/use-cases/get-account.js';
import { GetBalance } from './application/use-cases/get-balance.js';
import { GetStatement } from './application/use-cases/get-statement.js';
import { TransferFunds } from './application/use-cases/transfer-funds.js';
import { WithdrawFunds } from './application/use-cases/withdraw-funds.js';
import { loadEnv } from './config/env.js';
import { buildApp } from './infrastructure/http/app.js';
import { LoggingEventPublisher } from './infrastructure/messaging/logging-event-publisher.js';
import { PostgresUnitOfWork } from './infrastructure/persistence/postgres/postgres-unit-of-work.js';
import { SystemClock } from './infrastructure/system/system-clock.js';
import { UuidGenerator } from './infrastructure/system/uuid-generator.js';

/**
 * Composition root: the only file in the codebase that knows about every
 * layer, wiring concrete adapters into use cases.
 */
async function main(): Promise<void> {
  const env = loadEnv();

  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  const uow = new PostgresUnitOfWork(pool);
  const clock = new SystemClock();
  const ids = new UuidGenerator();

  await ensureSystemAccounts(uow, ids, clock, env.SUPPORTED_CURRENCIES);

  const app = buildApp(
    {
      createAccount: new CreateAccount(uow, ids, clock),
      getAccount: new GetAccount(uow),
      closeAccount: new CloseAccount(uow, ids, clock),
      depositFunds: new DepositFunds(uow, ids, clock),
      withdrawFunds: new WithdrawFunds(uow, ids, clock),
      transferFunds: new TransferFunds(uow, ids, clock),
      getBalance: new GetBalance(uow),
      getStatement: new GetStatement(uow),
    },
    { logger: { level: env.LOG_LEVEL } },
  );

  // Drain the outbox on a fixed cadence, publishing committed events.
  const relay = new OutboxRelay(uow, new LoggingEventPublisher(app.log));
  const relayTimer = setInterval(() => {
    void relay.drain().catch((error) => app.log.error({ err: error }, 'outbox relay failed'));
  }, 1000);
  relayTimer.unref();

  const close = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    clearInterval(relayTimer);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
