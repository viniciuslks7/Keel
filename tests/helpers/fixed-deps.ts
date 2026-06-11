import { randomUUID } from 'node:crypto';
import { ensureSystemAccounts } from '../../src/application/bootstrap.js';
import type { Clock } from '../../src/application/ports/clock.js';
import type { IdGenerator } from '../../src/application/ports/id-generator.js';
import { CreateAccount } from '../../src/application/use-cases/create-account.js';
import { DepositFunds } from '../../src/application/use-cases/deposit-funds.js';
import { GetAccount } from '../../src/application/use-cases/get-account.js';
import { GetBalance } from '../../src/application/use-cases/get-balance.js';
import { GetStatement } from '../../src/application/use-cases/get-statement.js';
import { TransferFunds } from '../../src/application/use-cases/transfer-funds.js';
import { WithdrawFunds } from '../../src/application/use-cases/withdraw-funds.js';
import { InMemoryUnitOfWork } from '../../src/infrastructure/persistence/in-memory/in-memory-unit-of-work.js';

export class TickingClock implements Clock {
  private current: number;

  constructor(startIso = '2026-01-01T00:00:00.000Z') {
    this.current = new Date(startIso).getTime();
  }

  now(): Date {
    // Each reading advances 1ms so entry ordering is deterministic in tests.
    this.current += 1;
    return new Date(this.current);
  }
}

export class RandomIds implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}

export interface TestContext {
  uow: InMemoryUnitOfWork;
  clock: TickingClock;
  ids: RandomIds;
  createAccount: CreateAccount;
  getAccount: GetAccount;
  depositFunds: DepositFunds;
  withdrawFunds: WithdrawFunds;
  transferFunds: TransferFunds;
  getBalance: GetBalance;
  getStatement: GetStatement;
}

export async function buildTestContext(
  currencies: readonly string[] = ['BRL', 'USD'],
): Promise<TestContext> {
  const uow = new InMemoryUnitOfWork();
  const clock = new TickingClock();
  const ids = new RandomIds();
  await ensureSystemAccounts(uow, ids, clock, currencies);

  return {
    uow,
    clock,
    ids,
    createAccount: new CreateAccount(uow, ids, clock),
    getAccount: new GetAccount(uow),
    depositFunds: new DepositFunds(uow, ids, clock),
    withdrawFunds: new WithdrawFunds(uow, ids, clock),
    transferFunds: new TransferFunds(uow, ids, clock),
    getBalance: new GetBalance(uow),
    getStatement: new GetStatement(uow),
  };
}
