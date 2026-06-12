import type { FastifyInstance } from 'fastify';
import type { AppDependencies } from '../app.js';
import { presentTransaction } from '../presenters.js';
import { exchangeBody, parseIdempotencyKey } from '../schemas.js';

export function registerExchangeRoutes(app: FastifyInstance, deps: AppDependencies): void {
  app.post('/exchanges', async (request, reply) => {
    const body = exchangeBody.parse(request.body);
    const idempotencyKey = parseIdempotencyKey(request.headers);
    const transaction = await deps.exchangeFunds.execute(
      idempotencyKey === undefined ? body : { ...body, idempotencyKey },
    );
    return reply.status(201).send(presentTransaction(transaction));
  });
}
