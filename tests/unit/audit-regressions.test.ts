import { describe, expect, it } from 'vitest';
import {
  IdempotencyConflictError,
  InvalidCursorError,
  InvalidMoneyError,
} from '../../src/domain/errors.js';
import { encodeCursor } from '../../src/infrastructure/persistence/cursor.js';
import { buildTestContext } from '../helpers/fixed-deps.js';

describe('audit regressions', () => {
  it('rejects reversed transfer retries and preserves both balances', async () => {
    const ctx = await buildTestContext();
    const a = await ctx.createAccount.execute({ ownerName: 'A', currency: 'BRL' });
    const b = await ctx.createAccount.execute({ ownerName: 'B', currency: 'BRL' });
    await ctx.depositFunds.execute({ accountId: a.id, amountCents: 1000 });
    const input = {
      fromAccountId: a.id,
      toAccountId: b.id,
      amountCents: 200,
      idempotencyKey: 'direction',
    };
    const first = await ctx.transferFunds.execute(input);
    expect((await ctx.transferFunds.execute(input)).id).toBe(first.id);
    await expect(
      ctx.transferFunds.execute({ ...input, fromAccountId: b.id, toAccountId: a.id }),
    ).rejects.toThrow(IdempotencyConflictError);
    expect((await ctx.getBalance.execute(a.id)).balanceCents).toBe(800);
    expect((await ctx.getBalance.execute(b.id)).balanceCents).toBe(200);
  });

  it('rejects exchange retries with the same combined amount but different legs', async () => {
    const ctx = await buildTestContext();
    const a = await ctx.createAccount.execute({ ownerName: 'A', currency: 'BRL' });
    const b = await ctx.createAccount.execute({ ownerName: 'B', currency: 'USD' });
    await ctx.depositFunds.execute({ accountId: a.id, amountCents: 1000 });
    await ctx.exchangeFunds.execute({
      fromAccountId: a.id,
      toAccountId: b.id,
      fromAmountCents: 500,
      rate: 0.2,
      idempotencyKey: 'fx-collision',
    });
    await expect(
      ctx.exchangeFunds.execute({
        fromAccountId: a.id,
        toAccountId: b.id,
        fromAmountCents: 400,
        rate: 0.5,
        idempotencyKey: 'fx-collision',
      }),
    ).rejects.toThrow(IdempotencyConflictError);
    expect((await ctx.getBalance.execute(a.id)).balanceCents).toBe(500);
    expect((await ctx.getBalance.execute(b.id)).balanceCents).toBe(100);
  });

  it('rejects unsafe cumulative balances and rolls back entries and outbox', async () => {
    const ctx = await buildTestContext();
    const a = await ctx.createAccount.execute({ ownerName: 'A', currency: 'BRL' });
    await ctx.depositFunds.execute({ accountId: a.id, amountCents: Number.MAX_SAFE_INTEGER });
    await expect(
      ctx.depositFunds.execute({ accountId: a.id, amountCents: 1, idempotencyKey: 'overflow' }),
    ).rejects.toThrow(InvalidMoneyError);
    expect((await ctx.getBalance.execute(a.id)).balanceCents).toBe(Number.MAX_SAFE_INTEGER);
    expect((await ctx.getStatement.execute({ accountId: a.id, limit: 20 })).entries).toHaveLength(
      1,
    );
    expect(
      await ctx.uow.run(({ transactions }) => transactions.findByIdempotencyKey('overflow')),
    ).toBeNull();
  });

  it.each([
    { createdAt: 'not-a-date', id: 'not-a-uuid' },
    { createdAt: '2026-02-30T00:00:00.000Z', id: '00000000-0000-4000-8000-000000000000' },
    { createdAt: '2026-01-01T00:00:00.000Z', id: 'bad-id' },
  ])('rejects structurally valid but unusable cursors: %j', async (cursor) => {
    const ctx = await buildTestContext();
    const a = await ctx.createAccount.execute({ ownerName: 'A', currency: 'BRL' });
    await expect(
      ctx.getStatement.execute({ accountId: a.id, limit: 2, cursor: encodeCursor(cursor) }),
    ).rejects.toThrow(InvalidCursorError);
  });

  it('uses keyset bounds even when the cursor entry belongs to another account', async () => {
    const ctx = await buildTestContext();
    const a = await ctx.createAccount.execute({ ownerName: 'A', currency: 'BRL' });
    const b = await ctx.createAccount.execute({ ownerName: 'B', currency: 'BRL' });
    await ctx.depositFunds.execute({ accountId: a.id, amountCents: 100 });
    const middle = await ctx.depositFunds.execute({ accountId: b.id, amountCents: 200 });
    await ctx.depositFunds.execute({ accountId: a.id, amountCents: 300 });
    const entry = middle.entries.find((e) => e.accountId === b.id);
    if (!entry) throw new Error('missing entry');
    const page = await ctx.getStatement.execute({
      accountId: a.id,
      limit: 2,
      cursor: encodeCursor({ createdAt: entry.createdAt.toISOString(), id: entry.id }),
    });
    expect(page.entries.map((e) => e.amountCents)).toEqual([100]);
  });
});
