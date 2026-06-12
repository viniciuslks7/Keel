import { beforeEach, describe, expect, it } from 'vitest';
import { InsufficientFundsError } from '../../src/domain/errors.js';
import { buildTestContext, type TestContext } from '../helpers/fixed-deps.js';

/**
 * Independent oracle: recompute an account's balance from its raw entries via
 * the statement, the path that does NOT read the materialized balance. If this
 * agrees with getBalance after every operation, the running balance is in step
 * with the append-only entries (ADR-0008).
 */
async function sumFromEntries(ctx: TestContext, accountId: string): Promise<number> {
  const page = await ctx.getStatement.execute({ accountId, limit: 10_000 });
  return page.entries.reduce(
    (total, entry) =>
      total + (entry.direction === 'CREDIT' ? entry.amountCents : -entry.amountCents),
    0,
  );
}

async function expectConsistent(ctx: TestContext, accountId: string): Promise<number> {
  const materialized = (await ctx.getBalance.execute(accountId)).balanceCents;
  expect(materialized).toBe(await sumFromEntries(ctx, accountId));
  return materialized;
}

describe('materialized balances stay equal to the sum of entries', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestContext();
  });

  it('reads zero for an account with no movements', async () => {
    const account = await ctx.createAccount.execute({ ownerName: 'Ana', currency: 'BRL' });
    expect(await expectConsistent(ctx, account.id)).toBe(0);
  });

  it('tracks deposits, withdrawals and transfers across both sides', async () => {
    const ana = await ctx.createAccount.execute({ ownerName: 'Ana', currency: 'BRL' });
    const beto = await ctx.createAccount.execute({ ownerName: 'Beto', currency: 'BRL' });

    await ctx.depositFunds.execute({ accountId: ana.id, amountCents: 10_00 });
    expect(await expectConsistent(ctx, ana.id)).toBe(10_00);

    await ctx.withdrawFunds.execute({ accountId: ana.id, amountCents: 3_00 });
    expect(await expectConsistent(ctx, ana.id)).toBe(7_00);

    await ctx.transferFunds.execute({
      fromAccountId: ana.id,
      toAccountId: beto.id,
      amountCents: 4_00,
    });
    expect(await expectConsistent(ctx, ana.id)).toBe(3_00);
    expect(await expectConsistent(ctx, beto.id)).toBe(4_00);
  });

  it('keeps the SYSTEM treasury balance mirroring customer movements', async () => {
    const ana = await ctx.createAccount.execute({ ownerName: 'Ana', currency: 'BRL' });
    const deposit = await ctx.depositFunds.execute({ accountId: ana.id, amountCents: 8_00 });

    // The treasury account is the counterparty leg on every deposit.
    const treasuryLeg = deposit.entries.find((entry) => entry.accountId !== ana.id);
    const treasuryId = treasuryLeg?.accountId ?? '';

    // The treasury was debited 8_00 against Ana's 8_00 credit: the ledger nets to zero.
    const treasury = await expectConsistent(ctx, treasuryId);
    const customer = await expectConsistent(ctx, ana.id);
    expect(treasury + customer).toBe(0);
  });

  it('does not move the balance when an operation rolls back', async () => {
    const ana = await ctx.createAccount.execute({ ownerName: 'Ana', currency: 'BRL' });
    await ctx.depositFunds.execute({ accountId: ana.id, amountCents: 5_00 });

    await expect(
      ctx.withdrawFunds.execute({ accountId: ana.id, amountCents: 9_00 }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    // The failed withdrawal left neither an entry nor a balance change behind.
    expect(await expectConsistent(ctx, ana.id)).toBe(5_00);
  });
});
