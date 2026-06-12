export type DomainErrorCode =
  | 'INVALID_MONEY'
  | 'INVALID_AMOUNT'
  | 'CURRENCY_MISMATCH'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_CLOSED'
  | 'ACCOUNT_NOT_EMPTY'
  | 'INSUFFICIENT_FUNDS'
  | 'UNBALANCED_TRANSACTION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SYSTEM_ACCOUNT_MISSING'
  | 'SYSTEM_ACCOUNT_PROTECTED'
  | 'SELF_TRANSFER'
  | 'INVALID_CURSOR';

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidMoneyError extends DomainError {
  readonly code = 'INVALID_MONEY';
}

export class InvalidAmountError extends DomainError {
  readonly code = 'INVALID_AMOUNT';
}

export class CurrencyMismatchError extends DomainError {
  readonly code = 'CURRENCY_MISMATCH';
}

export class AccountNotFoundError extends DomainError {
  readonly code = 'ACCOUNT_NOT_FOUND';

  constructor(accountId: string) {
    super(`account ${accountId} was not found`);
  }
}

export class AccountClosedError extends DomainError {
  readonly code = 'ACCOUNT_CLOSED';

  constructor(accountId: string) {
    super(`account ${accountId} is closed and cannot transact`);
  }
}

export class InsufficientFundsError extends DomainError {
  readonly code = 'INSUFFICIENT_FUNDS';

  constructor(accountId: string, balanceCents: number, requestedCents: number) {
    super(
      `account ${accountId} holds ${balanceCents} cents but ${requestedCents} cents were requested`,
    );
  }
}

export class AccountNotEmptyError extends DomainError {
  readonly code = 'ACCOUNT_NOT_EMPTY';

  constructor(accountId: string, balanceCents: number) {
    super(`account ${accountId} cannot be closed while it holds ${balanceCents} cents`);
  }
}

export class SystemAccountProtectedError extends DomainError {
  readonly code = 'SYSTEM_ACCOUNT_PROTECTED';

  constructor(accountId: string) {
    super(`account ${accountId} is a SYSTEM treasury account and cannot be closed`);
  }
}

export class UnbalancedTransactionError extends DomainError {
  readonly code = 'UNBALANCED_TRANSACTION';
}

export class IdempotencyConflictError extends DomainError {
  readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor(key: string) {
    super(`idempotency key "${key}" was already used with a different request payload`);
  }
}

export class SystemAccountMissingError extends DomainError {
  readonly code = 'SYSTEM_ACCOUNT_MISSING';

  constructor(currency: string) {
    super(`no SYSTEM treasury account exists for currency ${currency}`);
  }
}

export class SelfTransferError extends DomainError {
  readonly code = 'SELF_TRANSFER';

  constructor() {
    super('source and destination accounts must differ');
  }
}

export class InvalidCursorError extends DomainError {
  readonly code = 'INVALID_CURSOR';

  constructor() {
    super('the supplied pagination cursor is malformed');
  }
}
