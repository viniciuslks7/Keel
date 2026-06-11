import type { FastifyInstance } from 'fastify';
import type { AppDependencies } from '../app.js';
import { presentTransaction } from '../presenters.js';
import { parseIdempotencyKey, transferBody } from '../schemas.js';

export function registerTransferRoutes(app: FastifyInstance, deps: AppDependencies): void {
  app.post('/transfers', async (request, reply) => {
    const body = transferBody.parse(request.body);
    const idempotencyKey = parseIdempotencyKey(request.headers);
    const transaction = await deps.transferFunds.execute(
      idempotencyKey === undefined ? body : { ...body, idempotencyKey },
    );
    return reply.status(201).send(presentTransaction(transaction));
  });
}
