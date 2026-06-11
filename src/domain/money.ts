import { CurrencyMismatchError, InvalidMoneyError } from './errors.js';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Immutable monetary value stored as an integer amount of minor units (cents).
 * Floating point never touches money in this codebase — see ADR-0003.
 */
export class Money {
  private constructor(
    readonly cents: number,
    readonly currency: string,
  ) {}

  static of(cents: number, currency: string): Money {
    if (!Number.isSafeInteger(cents)) {
      throw new InvalidMoneyError('monetary amounts must be safe integers of minor units');
    }
    if (!CURRENCY_PATTERN.test(currency)) {
      throw new InvalidMoneyError(`"${currency}" is not an ISO 4217 currency code`);
    }
    return new Money(cents, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.cents + other.cents, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.cents - other.cents, this.currency);
  }

  isPositive(): boolean {
    return this.cents > 0;
  }

  isNegative(): boolean {
    return this.cents < 0;
  }

  lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents < other.cents;
  }

  equals(other: Money): boolean {
    return this.cents === other.cents && this.currency === other.currency;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(
        `cannot operate on ${this.currency} and ${other.currency} together`,
      );
    }
  }
}
