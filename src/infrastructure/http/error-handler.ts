import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { DomainError, type DomainErrorCode } from '../../domain/errors.js';

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  INVALID_MONEY: 400,
  INVALID_AMOUNT: 400,
  INVALID_CURSOR: 400,
  CURRENCY_MISMATCH: 422,
  INSUFFICIENT_FUNDS: 422,
  SELF_TRANSFER: 422,
  ACCOUNT_NOT_FOUND: 404,
  ACCOUNT_CLOSED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  UNBALANCED_TRANSACTION: 500,
  SYSTEM_ACCOUNT_MISSING: 422,
};

/**
 * Maps domain and validation failures onto RFC 9457 problem+json responses.
 * Internal failures are logged with full detail but leave the wire with a
 * generic message, so stack traces never leak to clients.
 */
export function errorHandler(
  error: FastifyError | DomainError | ZodError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof DomainError) {
    const status = STATUS_BY_CODE[error.code];
    if (status >= 500) {
      request.log.error({ err: error }, 'ledger invariant violated');
    }
    reply
      .status(status)
      .type('application/problem+json')
      .send({
        type: `https://keel.dev/errors/${error.code.toLowerCase().replaceAll('_', '-')}`,
        title: error.code,
        status,
        detail: status >= 500 ? 'internal ledger error' : error.message,
      });
    return;
  }

  if (error instanceof ZodError) {
    reply
      .status(400)
      .type('application/problem+json')
      .send({
        type: 'https://keel.dev/errors/validation',
        title: 'VALIDATION_ERROR',
        status: 400,
        detail: 'request payload failed validation',
        errors: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    return;
  }

  const status = error.statusCode ?? 500;
  if (status >= 500) {
    request.log.error({ err: error }, 'unhandled error');
  }
  reply
    .status(status)
    .type('application/problem+json')
    .send({
      type: 'about:blank',
      title: status >= 500 ? 'INTERNAL_ERROR' : error.name,
      status,
      detail: status >= 500 ? 'unexpected internal error' : error.message,
    });
}
