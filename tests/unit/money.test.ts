import { describe, expect, it } from 'vitest';
import { CurrencyMismatchError, InvalidMoneyError } from '../../src/domain/errors.js';
import { Money } from '../../src/domain/money.js';

describe('Money', () => {
  it('holds integer minor units and a currency', () => {
    const m = Money.of(1050, 'BRL');
    expect(m.cents).toBe(1050);
    expect(m.currency).toBe('BRL');
  });

  it('rejects fractional cents', () => {
    expect(() => Money.of(10.5, 'BRL')).toThrow(InvalidMoneyError);
  });

  it('rejects unsafe integers', () => {
    expect(() => Money.of(Number.MAX_SAFE_INTEGER + 1, 'BRL')).toThrow(InvalidMoneyError);
  });

  it('rejects malformed currency codes', () => {
    expect(() => Money.of(100, 'br')).toThrow(InvalidMoneyError);
    expect(() => Money.of(100, 'REAL')).toThrow(InvalidMoneyError);
  });

  it('adds and subtracts within one currency', () => {
    const a = Money.of(300, 'USD');
    const b = Money.of(120, 'USD');
    expect(a.add(b).cents).toBe(420);
    expect(a.subtract(b).cents).toBe(180);
  });

  it('refuses arithmetic across currencies', () => {
    expect(() => Money.of(100, 'USD').add(Money.of(100, 'BRL'))).toThrow(CurrencyMismatchError);
  });

  it('compares amounts', () => {
    expect(Money.of(99, 'BRL').lessThan(Money.of(100, 'BRL'))).toBe(true);
    expect(Money.of(100, 'BRL').equals(Money.of(100, 'BRL'))).toBe(true);
    expect(Money.of(100, 'BRL').equals(Money.of(100, 'USD'))).toBe(false);
  });
});
