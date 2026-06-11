import { type Account, isTransactable } from '../domain/account.js';
import {
  AccountClosedError,
  AccountNotFoundError,
  SystemAccountMissingError,
} from '../domain/errors.js';
import type { AccountRepository } from './ports/account-repository.js';

export async function requireActiveAccount(
  accounts: AccountRepository,
  id: string,
): Promise<Account> {
  const account = await accounts.findById(id);
  if (!account) {
    throw new AccountNotFoundError(id);
  }
  if (!isTransactable(account)) {
    throw new AccountClosedError(id);
  }
  return account;
}

export async function requireSystemAccount(
  accounts: AccountRepository,
  currency: string,
): Promise<Account> {
  const system = await accounts.findSystemAccount(currency);
  if (!system) {
    throw new SystemAccountMissingError(currency);
  }
  return system;
}
