import { z } from 'zod';

export const createAccountBody = z.object({
  ownerName: z.string().trim().min(1).max(120),
  currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO 4217 code'),
});

export const accountParams = z.object({
  accountId: z.string().uuid(),
});

export const moneyMovementBody = z.object({
  amountCents: z.number().int().positive(),
});

export const transferBody = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amountCents: z.number().int().positive(),
});

export const exchangeBody = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  fromAmountCents: z.number().int().positive(),
  rate: z.number().positive().finite(),
});

export const statementQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export const idempotencyKeyHeader = z.string().trim().min(1).max(255).optional();

export function parseIdempotencyKey(headers: Record<string, unknown>): string | undefined {
  const raw = headers['idempotency-key'];
  return idempotencyKeyHeader.parse(typeof raw === 'string' ? raw : undefined);
}
