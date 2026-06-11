import { describe, expect, it } from 'vitest';
import { CurrencyMismatchError, UnbalancedTransactionError } from '../../src/domain/errors.js';
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

  it('rejects mixed currencies in one transaction', () => {
    expect(() =>
      post([
        { accountId: 'a', direction: 'DEBIT', amount: Money.of(500, 'BRL') },
        { accountId: 'b', direction: 'CREDIT', amount: Money.of(500, 'USD') },
      ]),
    ).toThrow(CurrencyMismatchError);
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
