import { ensureSystemAccounts } from '../src/application/bootstrap.js';
import type { IdGenerator } from '../src/application/ports/id-generator.js';
import type { StatementPage } from '../src/application/ports/transaction-repository.js';
import { CloseAccount } from '../src/application/use-cases/close-account.js';
import {
  CreateAccount,
  type CreateAccountInput,
} from '../src/application/use-cases/create-account.js';
import {
  DepositFunds,
  type DepositFundsInput,
} from '../src/application/use-cases/deposit-funds.js';
import { GetAccount } from '../src/application/use-cases/get-account.js';
import { type BalanceView, GetBalance } from '../src/application/use-cases/get-balance.js';
import {
  GetStatement,
  type GetStatementInput,
} from '../src/application/use-cases/get-statement.js';
import {
  TransferFunds,
  type TransferFundsInput,
} from '../src/application/use-cases/transfer-funds.js';
import {
  WithdrawFunds,
  type WithdrawFundsInput,
} from '../src/application/use-cases/withdraw-funds.js';
import type { Account } from '../src/domain/account.js';
import type { Transaction } from '../src/domain/transaction.js';
import { InMemoryUnitOfWork } from '../src/infrastructure/persistence/in-memory/in-memory-unit-of-work.js';
import { SystemClock } from '../src/infrastructure/system/system-clock.js';

/**
 * Browser entrypoint for the static demo. It boots the *exact same* domain and
 * application code that the production HTTP service uses, wired to the
 * in-memory adapter, and exposes it on `globalThis.createKeel`. No server, no
 * network — a live proof that the hexagonal core is independent of its
 * delivery mechanism. State lives in the tab and resets on reload.
 */

/** UUID v4 via Web Crypto — works in every browsing context, including file://. */
class WebCryptoIds implements IdGenerator {
  next(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }
}

export interface KeelDemo {
  readonly currencies: readonly string[];
  createAccount(input: CreateAccountInput): Promise<Account>;
  getAccount(id: string): Promise<Account>;
  closeAccount(id: string): Promise<Account>;
  getBalance(id: string): Promise<BalanceView>;
  deposit(input: DepositFundsInput): Promise<Transaction>;
  withdraw(input: WithdrawFundsInput): Promise<Transaction>;
  transfer(input: TransferFundsInput): Promise<Transaction>;
  statement(input: GetStatementInput): Promise<StatementPage>;
}

async function createKeel(currencies: readonly string[] = ['BRL', 'USD']): Promise<KeelDemo> {
  const uow = new InMemoryUnitOfWork();
  const ids = new WebCryptoIds();
  const clock = new SystemClock();

  await ensureSystemAccounts(uow, ids, clock, currencies);

  const createAccount = new CreateAccount(uow, ids, clock);
  const getAccount = new GetAccount(uow);
  const closeAccount = new CloseAccount(uow, ids, clock);
  const getBalance = new GetBalance(uow);
  const depositFunds = new DepositFunds(uow, ids, clock);
  const withdrawFunds = new WithdrawFunds(uow, ids, clock);
  const transferFunds = new TransferFunds(uow, ids, clock);
  const getStatement = new GetStatement(uow);

  return {
    currencies,
    createAccount: (input) => createAccount.execute(input),
    getAccount: (id) => getAccount.execute(id),
    closeAccount: (id) => closeAccount.execute(id),
    getBalance: (id) => getBalance.execute(id),
    deposit: (input) => depositFunds.execute(input),
    withdraw: (input) => withdrawFunds.execute(input),
    transfer: (input) => transferFunds.execute(input),
    statement: (input) => getStatement.execute(input),
  };
}

(globalThis as unknown as { createKeel: typeof createKeel }).createKeel = createKeel;
