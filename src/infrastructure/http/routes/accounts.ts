import type { FastifyInstance } from 'fastify';
import type { AppDependencies } from '../app.js';
import { presentAccount, presentEntry, presentTransaction } from '../presenters.js';
import {
  accountParams,
  createAccountBody,
  moneyMovementBody,
  parseIdempotencyKey,
  statementQuery,
} from '../schemas.js';

export function registerAccountRoutes(app: FastifyInstance, deps: AppDependencies): void {
  app.post('/accounts', async (request, reply) => {
    const body = createAccountBody.parse(request.body);
    const account = await deps.createAccount.execute(body);
    return reply.status(201).send(presentAccount(account));
  });

  app.get('/accounts/:accountId', async (request) => {
    const { accountId } = accountParams.parse(request.params);
    const account = await deps.getAccount.execute(accountId);
    return presentAccount(account);
  });

  app.post('/accounts/:accountId/close', async (request) => {
    const { accountId } = accountParams.parse(request.params);
    const account = await deps.closeAccount.execute(accountId);
    return presentAccount(account);
  });

  app.get('/accounts/:accountId/balance', async (request) => {
    const { accountId } = accountParams.parse(request.params);
    return deps.getBalance.execute(accountId);
  });

  app.get('/accounts/:accountId/statement', async (request) => {
    const { accountId } = accountParams.parse(request.params);
    const { limit, cursor } = statementQuery.parse(request.query);
    const page = await deps.getStatement.execute(
      cursor === undefined ? { accountId, limit } : { accountId, limit, cursor },
    );
    return {
      entries: page.entries.map(presentEntry),
      nextCursor: page.nextCursor,
    };
  });

  app.post('/accounts/:accountId/deposits', async (request, reply) => {
    const { accountId } = accountParams.parse(request.params);
    const { amountCents } = moneyMovementBody.parse(request.body);
    const idempotencyKey = parseIdempotencyKey(request.headers);
    const transaction = await deps.depositFunds.execute(
      idempotencyKey === undefined
        ? { accountId, amountCents }
        : { accountId, amountCents, idempotencyKey },
    );
    return reply.status(201).send(presentTransaction(transaction));
  });

  app.post('/accounts/:accountId/withdrawals', async (request, reply) => {
    const { accountId } = accountParams.parse(request.params);
    const { amountCents } = moneyMovementBody.parse(request.body);
    const idempotencyKey = parseIdempotencyKey(request.headers);
    const transaction = await deps.withdrawFunds.execute(
      idempotencyKey === undefined
        ? { accountId, amountCents }
        : { accountId, amountCents, idempotencyKey },
    );
    return reply.status(201).send(presentTransaction(transaction));
  });
}
