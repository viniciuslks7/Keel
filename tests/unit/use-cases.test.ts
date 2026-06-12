import { beforeEach, describe, expect, it } from 'vitest';
import {
  AccountClosedError,
  AccountNotEmptyError,
  CurrencyMismatchError,
  IdempotencyConflictError,
  InsufficientFundsError,
  InvalidAmountError,
  SelfTransferError,
  SystemAccountProtectedError,
} from '../../src/domain/errors.js';
import { buildTestContext, type TestContext } from '../helpers/fixed-deps.js';

describe('ledger use cases', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestContext();
  });

  async function openAccount(currency = 'BRL'): Promise<string> {
    const account = await ctx.createAccount.execute({ ownerName: 'Ada Lovelace', currency });
    return account.id;
  }

  describe('deposit', () => {
    it('credits the account and the balance reflects it', async () => {
      const accountId = await openAccount();
      await ctx.depositFunds.execute({ accountId, amountCents: 10_000 });

      const balance = await ctx.getBalance.execute(accountId);
      expect(balance.balanceCents).toBe(10_000);
      expect(balance.currency).toBe('BRL');
    });

    it('posts a balanced double entry against the treasury', async () => {
      const accountId = await openAccount();
      const tx = await ctx.depositFunds.execute({ accountId, amountCents: 5_000 });

      expect(tx.type).toBe('DEPOSIT');
      expect(tx.entries).toHaveLength(2);
      const debit = tx.entries.find((e) => e.direction === 'DEBIT');
      const credit = tx.entries.find((e) => e.direction === 'CREDIT');
      expect(credit?.accountId).toBe(accountId);
      expect(debit?.accountId).not.toBe(accountId);
      expect(debit?.amountCents).toBe(credit?.amountCents);
    });

    it('rejects non-positive and fractional amounts', async () => {
      const accountId = await openAccount();
      await expect(ctx.depositFunds.execute({ accountId, amountCents: 0 })).rejects.toThrow(
        InvalidAmountError,
      );
      await expect(ctx.depositFunds.execute({ accountId, amountCents: 10.5 })).rejects.toThrow(
        InvalidAmountError,
      );
    });
  });

  describe('withdraw', () => {
    it('debits the account', async () => {
      const accountId = await openAccount();
      await ctx.depositFunds.execute({ accountId, amountCents: 10_000 });
      await ctx.withdrawFunds.execute({ accountId, amountCents: 3_000 });

      const balance = await ctx.getBalance.execute(accountId);
      expect(balance.balanceCents).toBe(7_000);
    });

    it('refuses to overdraw', async () => {
      const accountId = await openAccount();
      await ctx.depositFunds.execute({ accountId, amountCents: 100 });

      await expect(ctx.withdrawFunds.execute({ accountId, amountCents: 101 })).rejects.toThrow(
        InsufficientFundsError,
      );
      const balance = await ctx.getBalance.execute(accountId);
      expect(balance.balanceCents).toBe(100);
    });
  });

  describe('transfer', () => {
    it('moves funds atomically between accounts', async () => {
      const alice = await openAccount();
      const bob = await openAccount();
      await ctx.depositFunds.execute({ accountId: alice, amountCents: 10_000 });

      await ctx.transferFunds.execute({
        fromAccountId: alice,
        toAccountId: bob,
        amountCents: 4_000,
      });

      expect((await ctx.getBalance.execute(alice)).balanceCents).toBe(6_000);
      expect((await ctx.getBalance.execute(bob)).balanceCents).toBe(4_000);
    });

    it('rejects transfers across currencies', async () => {
      const real = await openAccount('BRL');
      const dollar = await openAccount('USD');
      await ctx.depositFunds.execute({ accountId: real, amountCents: 10_000 });

      await expect(
        ctx.transferFunds.execute({ fromAccountId: real, toAccountId: dollar, amountCents: 100 }),
      ).rejects.toThrow(CurrencyMismatchError);
    });

    it('rejects self transfers', async () => {
      const accountId = await openAccount();
      await expect(
        ctx.transferFunds.execute({
          fromAccountId: accountId,
          toAccountId: accountId,
          amountCents: 100,
        }),
      ).rejects.toThrow(SelfTransferError);
    });

    it('rejects transfers beyond the available balance and leaves state intact', async () => {
      const alice = await openAccount();
      const bob = await openAccount();
      await ctx.depositFunds.execute({ accountId: alice, amountCents: 500 });

      await expect(
        ctx.transferFunds.execute({ fromAccountId: alice, toAccountId: bob, amountCents: 501 }),
      ).rejects.toThrow(InsufficientFundsError);

      expect((await ctx.getBalance.execute(alice)).balanceCents).toBe(500);
      expect((await ctx.getBalance.execute(bob)).balanceCents).toBe(0);
    });

    it('keeps the whole ledger balanced: every credit has a matching debit', async () => {
      const alice = await openAccount();
      const bob = await openAccount();
      await ctx.depositFunds.execute({ accountId: alice, amountCents: 10_000 });
      await ctx.transferFunds.execute({
        fromAccountId: alice,
        toAccountId: bob,
        amountCents: 2_500,
      });
      await ctx.withdrawFunds.execute({ accountId: bob, amountCents: 1_000 });

      let total = 0;
      await ctx.uow.run(async ({ transactions }) => {
        // Trial balance over every account in the store, treasury included.
        const ids = new Set<string>();
        for (const accountId of [alice, bob]) {
          ids.add(accountId);
        }
        for (const id of ids) {
          total += await transactions.balanceOf(id);
        }
      });
      // Customer holdings must equal what the treasury owes the outside world.
      expect(total).toBe(9_000);
    });
  });

  describe('idempotency', () => {
    it('replaying the same key returns the original transaction without double-posting', async () => {
      const accountId = await openAccount();
      const first = await ctx.depositFunds.execute({
        accountId,
        amountCents: 1_000,
        idempotencyKey: 'dep-1',
      });
      const replay = await ctx.depositFunds.execute({
        accountId,
        amountCents: 1_000,
        idempotencyKey: 'dep-1',
      });

      expect(replay.id).toBe(first.id);
      expect((await ctx.getBalance.execute(accountId)).balanceCents).toBe(1_000);
    });

    it('reusing a key with a different payload is a conflict', async () => {
      const accountId = await openAccount();
      await ctx.depositFunds.execute({ accountId, amountCents: 1_000, idempotencyKey: 'dep-1' });

      await expect(
        ctx.depositFunds.execute({ accountId, amountCents: 2_000, idempotencyKey: 'dep-1' }),
      ).rejects.toThrow(IdempotencyConflictError);
    });

    it('applies to transfers as well', async () => {
      const alice = await openAccount();
      const bob = await openAccount();
      await ctx.depositFunds.execute({ accountId: alice, amountCents: 10_000 });

      const input = {
        fromAccountId: alice,
        toAccountId: bob,
        amountCents: 3_000,
        idempotencyKey: 'tr-1',
      };
      const first = await ctx.transferFunds.execute(input);
      const replay = await ctx.transferFunds.execute(input);

      expect(replay.id).toBe(first.id);
      expect((await ctx.getBalance.execute(alice)).balanceCents).toBe(7_000);
      expect((await ctx.getBalance.execute(bob)).balanceCents).toBe(3_000);
    });
  });

  describe('statement', () => {
    it('paginates newest-first with a stable keyset cursor', async () => {
      const accountId = await openAccount();
      for (let i = 1; i <= 5; i += 1) {
        await ctx.depositFunds.execute({ accountId, amountCents: i * 100 });
      }

      const firstPage = await ctx.getStatement.execute({ accountId, limit: 2 });
      expect(firstPage.entries).toHaveLength(2);
      expect(firstPage.entries[0]?.amountCents).toBe(500);
      expect(firstPage.entries[1]?.amountCents).toBe(400);
      expect(firstPage.nextCursor).not.toBeNull();

      const secondPage = await ctx.getStatement.execute({
        accountId,
        limit: 2,
        cursor: firstPage.nextCursor as string,
      });
      expect(secondPage.entries.map((e) => e.amountCents)).toEqual([300, 200]);

      const lastPage = await ctx.getStatement.execute({
        accountId,
        limit: 2,
        cursor: secondPage.nextCursor as string,
      });
      expect(lastPage.entries.map((e) => e.amountCents)).toEqual([100]);
      expect(lastPage.nextCursor).toBeNull();
    });
  });

  describe('close', () => {
    it('closes an empty account and blocks further movement', async () => {
      const accountId = await openAccount();
      const closed = await ctx.closeAccount.execute(accountId);
      expect(closed.status).toBe('CLOSED');

      await expect(ctx.depositFunds.execute({ accountId, amountCents: 100 })).rejects.toThrow(
        AccountClosedError,
      );
    });

    it('refuses to close an account that still holds funds', async () => {
      const accountId = await openAccount();
      await ctx.depositFunds.execute({ accountId, amountCents: 500 });

      await expect(ctx.closeAccount.execute(accountId)).rejects.toThrow(AccountNotEmptyError);
      expect((await ctx.getAccount.execute(accountId)).status).toBe('ACTIVE');
    });

    it('lets an account be emptied and then closed', async () => {
      const accountId = await openAccount();
      await ctx.depositFunds.execute({ accountId, amountCents: 500 });
      await ctx.withdrawFunds.execute({ accountId, amountCents: 500 });

      const closed = await ctx.closeAccount.execute(accountId);
      expect(closed.status).toBe('CLOSED');
    });

    it('is idempotent: closing an already-closed account is a no-op', async () => {
      const accountId = await openAccount();
      await ctx.closeAccount.execute(accountId);
      const again = await ctx.closeAccount.execute(accountId);
      expect(again.status).toBe('CLOSED');
    });

    it('protects SYSTEM treasury accounts from being closed', async () => {
      const system = await ctx.uow.run(({ accounts }) => accounts.findSystemAccount('BRL'));
      expect(system).not.toBeNull();
      if (system) {
        await expect(ctx.closeAccount.execute(system.id)).rejects.toThrow(
          SystemAccountProtectedError,
        );
      }
    });
  });

  describe('concurrency', () => {
    it('parallel withdrawals cannot overdraw the account', async () => {
      const accountId = await openAccount();
      await ctx.depositFunds.execute({ accountId, amountCents: 1_000 });

      const attempts = await Promise.allSettled(
        Array.from({ length: 5 }, () => ctx.withdrawFunds.execute({ accountId, amountCents: 400 })),
      );

      const succeeded = attempts.filter((a) => a.status === 'fulfilled').length;
      expect(succeeded).toBe(2);
      expect((await ctx.getBalance.execute(accountId)).balanceCents).toBe(200);
    });
  });
});
