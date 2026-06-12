import { describe, expect, it } from 'vitest';
import { UnbalancedTransactionError } from '../../src/domain/errors.js';
import { type PostingLeg, postTransaction } from '../../src/domain/ledger.js';
import { Money } from '../../src/domain/money.js';

const NOW = new Date('2026-01-01T12:00:00Z');

function post(legs: PostingLeg[], entryIds = legs.map((_, i) => `entry-${i}`)) {
  return postTransaction({
    id: 'tx-1',
    type: 'TRANSFER',
    idempotencyKey: null,
    legs,
    entryIds,
    createdAt: NOW,
  });
}

describe('postTransaction', () => {
  it('produces one entry per leg, all stamped with the transaction id', () => {
    const tx = post([
      { accountId: 'a', direction: 'DEBIT', amount: Money.of(500, 'BRL') },
      { accountId: 'b', direction: 'CREDIT', amount: Money.of(500, 'BRL') },
    ]);
    expect(tx.entries).toHaveLength(2);
    expect(tx.entries.every((e) => e.transactionId === 'tx-1')).toBe(true);
  });

  it('rejects transactions where debits and credits diverge', () => {
    expect(() =>
      post([
        { accountId: 'a', direction: 'DEBIT', amount: Money.of(500, 'BRL') },
        { accountId: 'b', direction: 'CREDIT', amount: Money.of(499, 'BRL') },
      ]),
    ).toThrow(UnbalancedTransactionError);
  });

  it('rejects single-leg transactions', () => {
    expect(() =>
      post([{ accountId: 'a', direction: 'DEBIT', amount: Money.of(500, 'BRL') }]),
    ).toThrow(UnbalancedTransactionError);
  });

  it('rejects a posting that does not balance within each currency', () => {
    // Each currency is lopsided on its own: BRL has only a debit, USD only a
    // credit. The transaction creates money in one currency and destroys it in
    // another, which is exactly what the per-currency balance rule forbids.
    expect(() =>
      post([
        { accountId: 'a', direction: 'DEBIT', amount: Money.of(500, 'BRL') },
        { accountId: 'b', direction: 'CREDIT', amount: Money.of(500, 'USD') },
      ]),
    ).toThrow(UnbalancedTransactionError);
  });

  it('accepts a cross-currency posting that balances each currency on its own', () => {
    // The shape of an FX transfer: BRL nets to zero (debit a, credit treasury)
    // and USD nets to zero (debit treasury, credit b), at an implied 1:2 rate.
    const tx = post(
      [
        { accountId: 'a', direction: 'DEBIT', amount: Money.of(500, 'BRL') },
        { accountId: 'brl-treasury', direction: 'CREDIT', amount: Money.of(500, 'BRL') },
        { accountId: 'usd-treasury', direction: 'DEBIT', amount: Money.of(1000, 'USD') },
        { accountId: 'b', direction: 'CREDIT', amount: Money.of(1000, 'USD') },
      ],
      ['e1', 'e2', 'e3', 'e4'],
    );
    expect(tx.entries).toHaveLength(4);
  });

  it('rejects non-positive legs even when they balance', () => {
    expect(() =>
      post([
        { accountId: 'a', direction: 'DEBIT', amount: Money.of(0, 'BRL') },
        { accountId: 'b', direction: 'CREDIT', amount: Money.of(0, 'BRL') },
      ]),
    ).toThrow(UnbalancedTransactionError);
  });

  it('supports multi-leg postings as long as they balance', () => {
    const tx = post(
      [
        { accountId: 'a', direction: 'DEBIT', amount: Money.of(1000, 'BRL') },
        { accountId: 'b', direction: 'CREDIT', amount: Money.of(700, 'BRL') },
        { accountId: 'c', direction: 'CREDIT', amount: Money.of(300, 'BRL') },
      ],
      ['e1', 'e2', 'e3'],
    );
    expect(tx.entries).toHaveLength(3);
  });
});
