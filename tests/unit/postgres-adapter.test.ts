import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { InvalidCursorError, InvalidMoneyError } from '../../src/domain/errors.js';
import { encodeCursor } from '../../src/infrastructure/persistence/cursor.js';
import { PostgresTransactionRepository } from '../../src/infrastructure/persistence/postgres/postgres-transaction-repository.js';

describe('PostgreSQL adapter boundaries (query doubles, no database)', () => {
  it('rejects invalid date/UUID cursors before sending SQL', async () => {
    const query = vi.fn();
    const repo = new PostgresTransactionRepository({ query } as unknown as PoolClient);
    await expect(
      repo.statementOf({
        accountId: 'account',
        limit: 20,
        cursor: encodeCursor({ createdAt: 'bad-date', id: 'bad-id' }),
      }),
    ).rejects.toThrow(InvalidCursorError);
    expect(query).not.toHaveBeenCalled();
  });

  it('acquires a transaction-scoped lock for the full key', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresTransactionRepository({ query } as unknown as PoolClient);
    await repo.lockIdempotencyKey('retry-key');
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      'retry-key',
    ]);
  });

  it('rejects a stored BIGINT that cannot be represented exactly', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ balance: '9007199254740993' }] });
    const repo = new PostgresTransactionRepository({ query } as unknown as PoolClient);
    await expect(repo.balanceOf('account')).rejects.toThrow(InvalidMoneyError);
  });

  it('rejects overflowing materialized balances during save, so the unit of work can roll back', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ balance_cents: '9007199254740992' }] });
    const repo = new PostgresTransactionRepository({ query } as unknown as PoolClient);
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    await expect(
      repo.save({
        id: 'tx',
        type: 'DEPOSIT',
        idempotencyKey: null,
        createdAt,
        entries: [
          {
            id: 'entry',
            transactionId: 'tx',
            accountId: 'account',
            direction: 'CREDIT',
            amountCents: 1,
            currency: 'BRL',
            createdAt,
          },
        ],
      }),
    ).rejects.toThrow(InvalidMoneyError);
  });
});
