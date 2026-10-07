import { describe, expect, it } from 'vitest';
import type { UnitOfWork } from '../../src/application/ports/unit-of-work.js';
import { DepositFunds } from '../../src/application/use-cases/deposit-funds.js';
import { AccountClosedError } from '../../src/domain/errors.js';
import { buildTestContext } from '../helpers/fixed-deps.js';

describe('status after lock acquisition', () => {
  it('refuses a deposit if an account closed while waiting for its lock', async () => {
    const ctx = await buildTestContext();
    const account = await ctx.createAccount.execute({ ownerName: 'Alex', currency: 'BRL' });
    // Model a committed close occurring between the first read and lock grant.
    // The memory adapter normally serializes whole units and cannot expose this interleaving.
    const uow: UnitOfWork = {
      run: (work) =>
        ctx.uow.run((repos) =>
          work({
            ...repos,
            accounts: {
              create: (a) => repos.accounts.create(a),
              findById: (id) => repos.accounts.findById(id),
              findSystemAccount: (currency) => repos.accounts.findSystemAccount(currency),
              updateStatus: (id, status) => repos.accounts.updateStatus(id, status),
              lockForUpdate: async (ids) => {
                await repos.accounts.updateStatus(account.id, 'CLOSED');
                return repos.accounts.lockForUpdate(ids);
              },
            },
          }),
        ),
    };
    await expect(
      new DepositFunds(uow, ctx.ids, ctx.clock).execute({
        accountId: account.id,
        amountCents: 100,
      }),
    ).rejects.toThrow(AccountClosedError);
    expect((await ctx.getBalance.execute(account.id)).balanceCents).toBe(0);
    expect(
      (await ctx.getStatement.execute({ accountId: account.id, limit: 20 })).entries,
    ).toHaveLength(0);
  });

  it('parallel identical retries produce one transaction and one posting', async () => {
    const ctx = await buildTestContext();
    const account = await ctx.createAccount.execute({ ownerName: 'Alex', currency: 'BRL' });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        ctx.depositFunds.execute({
          accountId: account.id,
          amountCents: 100,
          idempotencyKey: 'parallel',
        }),
      ),
    );
    expect(new Set(results.map((tx) => tx.id)).size).toBe(1);
    expect((await ctx.getBalance.execute(account.id)).balanceCents).toBe(100);
    expect(
      (await ctx.getStatement.execute({ accountId: account.id, limit: 20 })).entries,
    ).toHaveLength(1);
  });
});
