import Fastify, { type FastifyInstance } from 'fastify';
import type { CloseAccount } from '../../application/use-cases/close-account.js';
import type { CreateAccount } from '../../application/use-cases/create-account.js';
import type { DepositFunds } from '../../application/use-cases/deposit-funds.js';
import type { GetAccount } from '../../application/use-cases/get-account.js';
import type { GetBalance } from '../../application/use-cases/get-balance.js';
import type { GetStatement } from '../../application/use-cases/get-statement.js';
import type { TransferFunds } from '../../application/use-cases/transfer-funds.js';
import type { WithdrawFunds } from '../../application/use-cases/withdraw-funds.js';
import { errorHandler } from './error-handler.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerTransferRoutes } from './routes/transfers.js';

/**
 * The HTTP adapter depends exclusively on use cases — never on repositories
 * or the database — so the whole API can be exercised in-memory in tests.
 */
export interface AppDependencies {
  readonly createAccount: CreateAccount;
  readonly getAccount: GetAccount;
  readonly closeAccount: CloseAccount;
  readonly depositFunds: DepositFunds;
  readonly withdrawFunds: WithdrawFunds;
  readonly transferFunds: TransferFunds;
  readonly getBalance: GetBalance;
  readonly getStatement: GetStatement;
}

export interface AppOptions {
  readonly logger?: boolean | { level: string };
}

export function buildApp(deps: AppDependencies, options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.setErrorHandler(errorHandler);
  registerHealthRoutes(app);
  registerAccountRoutes(app, deps);
  registerTransferRoutes(app, deps);

  return app;
}
