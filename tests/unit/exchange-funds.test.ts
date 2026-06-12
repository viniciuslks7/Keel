import { beforeEach, describe, expect, it } from 'vitest';
import {
  AccountClosedError,
  CurrencyMismatchError,
  IdempotencyConflictError,
  InsufficientFundsError,
  InvalidAmountError,
  SelfTransferError,
} from '../../src/domain/errors.js';
import { buildTestContext, type TestContext } from '../helpers/fixed-deps.js';

describe('ExchangeFunds', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    // Two currencies so the per-currency treasuries both exist.
    ctx = await buildTestContext(['BRL', 'USD']);
  });

  async function brlAccountWith(amountCents: number): Promise<string> {
    const account = await ctx.createAccount.execute({ ownerName: 'Ana', currency: 'BRL' });
    if (amountCents > 0) {
      await ctx.depositFunds.execute({ accountId: account.id, amountCents });
    }
    return account.id;
  }

  it('debits the source and credits the destination at the converted amount', async () => {
    const from = await brlAccountWith(100_00);
    const to = (await ctx.createAccount.execute({ ownerName: 'Beto', currency: 'USD' })).id;

    const tx = await ctx.exchangeFunds.execute({
      fromAccountId: from,
      toAccountId: to,
      fromAmountCents: 50_00,
      rate: 0.2, // 50.00 BRL -> 10.00 USD
    });

    expect(tx.entries).toHaveLength(4);
    expect((await ctx.getBalance.execute(from)).balanceCents).toBe(50_00);
    expect((await ctx.getBalance.execute(to)).balanceCents).toBe(10_00);
  });

  it('keeps each currency internally balanced (no money created or destroyed)', async () => {
    const from = await brlAccountWith(100_00);
    const to = (await ctx.createAccount.execute({ ownerName: 'Beto', currency: 'USD' })).id;

    const tx = await ctx.exchangeFunds.execute({
      fromAccountId: from,
      toAccountId: to,
      fromAmountCents: 40_00,
      rate: 0.25,
    });

    const net = (currency: string): number =>
      tx.entries
        .filter((entry) => entry.currency === currency)
        .reduce((t, e) => t + (e.direction === 'CREDIT' ? e.amountCents : -e.amountCents), 0);

    expect(net('BRL')).toBe(0);
    expect(net('USD')).toBe(0);
  });

  it('rounds the converted amount to the nearest cent', async () => {
    const from = await brlAccountWith(100_00);
    const to = (await ctx.createAccount.execute({ ownerName: 'Beto', currency: 'USD' })).id;

    // 33_33 * 0.3 = 999.9 -> rounds to 10_00 cents.
    await ctx.exchangeFunds.execute({
      fromAccountId: from,
      toAccountId: to,
      fromAmountCents: 33_33,
      rate: 0.3,
    });

    expect((await ctx.getBalance.execute(to)).balanceCents).toBe(10_00);
  });

  it('rejects an exchange between two accounts of the same currency', async () => {
    const from = await brlAccountWith(10_00);
    const to = (await ctx.createAccount.execute({ ownerName: 'Beto', currency: 'BRL' })).id;

    await expect(
      ctx.exchangeFunds.execute({
        fromAccountId: from,
        toAccountId: to,
        fromAmountCents: 5_00,
        rate: 1,
      }),
    ).rejects.toBeInstanceOf(CurrencyMismatchError);
  });

  it('rejects a self exchange', async () => {
    const from = await brlAccountWith(10_00);
    await expect(
      ctx.exchangeFunds.execute({
        fromAccountId: from,
        toAccountId: from,
        fromAmountCents: 5_00,
        rate: 0.2,
      }),
    ).rejects.toBeInstanceOf(SelfTransferError);
  });

  it('rejects a non-positive or non-finite rate', async () => {
    const from = await brlAccountWith(10_00);
    const to = (await ctx.createAccount.execute({ ownerName: 'Beto', currency: 'USD' })).id;
    const base = { fromAccountId: from, toAccountId: to, fromAmountCents: 5_00 };

    await expect(ctx.exchangeFunds.execute({ ...base, rate: 0 })).rejects.toBeInstanceOf(
      InvalidAmountError,
    );
    await expect(
      ctx.exchangeFunds.execute({ ...base, rate: Number.POSITIVE_INFINITY }),
    ).rejects.toBeInstanceOf(InvalidAmountError);
  });

  it('rejects a conversion that rounds down to zero', async () => {
    const from = await brlAccountWith(10_00);
    const to = (await ctx.createAccount.execute({ ownerName: 'Beto', currency: 'USD' })).id;

    await expect(
      ctx.exchangeFunds.execute({
        fromAccountId: from,
        toAccountId: to,
        fromAmountCents: 1,
        rate: 0.4,
      }),
    ).rejects.toBeInstanceOf(InvalidAmountError);
  });

  it('rejects when the source lacks the funds, leaving balances untouched', async () => {
    const from = await brlAccountWith(3_00);
    const to = (await ctx.createAccount.execute({ ownerName: 'Beto', currency: 'USD' })).id;

    await expect(
      ctx.exchangeFunds.execute({
        fromAccountId: from,
        toAccountId: to,
        fromAmountCents: 5_00,
        rate: 0.2,
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    expect((await ctx.getBalance.execute(from)).balanceCents).toBe(3_00);
    expect((await ctx.getBalance.execute(to)).balanceCents).toBe(0);
  });

  it('rejects an exchange into a closed account', async () => {
    const from = await brlAccountWith(10_00);
    const to = await ctx.createAccount.execute({ ownerName: 'Beto', currency: 'USD' });
    await ctx.closeAccount.execute(to.id);

    await expect(
      ctx.exchangeFunds.execute({
        fromAccountId: from,
        toAccountId: to.id,
        fromAmountCents: 5_00,
        rate: 0.2,
      }),
    ).rejects.toBeInstanceOf(AccountClosedError);
  });

  it('replays an identical request under the same idempotency key', async () => {
    const from = await brlAccountWith(100_00);
    const to = (await ctx.createAccount.execute({ ownerName: 'Beto', currency: 'USD' })).id;
    const request = {
      fromAccountId: from,
      toAccountId: to,
      fromAmountCents: 50_00,
      rate: 0.2,
      idempotencyKey: 'exchange-1',
    };

    const first = await ctx.exchangeFunds.execute(request);
    const second = await ctx.exchangeFunds.execute(request);

    expect(second.id).toBe(first.id);
    // The money moved exactly once.
    expect((await ctx.getBalance.execute(from)).balanceCents).toBe(50_00);
    expect((await ctx.getBalance.execute(to)).balanceCents).toBe(10_00);
  });

  it('rejects reusing an idempotency key for a different exchange', async () => {
    const from = await brlAccountWith(100_00);
    const to = (await ctx.createAccount.execute({ ownerName: 'Beto', currency: 'USD' })).id;

    await ctx.exchangeFunds.execute({
      fromAccountId: from,
      toAccountId: to,
      fromAmountCents: 50_00,
      rate: 0.2,
      idempotencyKey: 'exchange-1',
    });

    await expect(
      ctx.exchangeFunds.execute({
        fromAccountId: from,
        toAccountId: to,
        fromAmountCents: 40_00,
        rate: 0.2,
        idempotencyKey: 'exchange-1',
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});
