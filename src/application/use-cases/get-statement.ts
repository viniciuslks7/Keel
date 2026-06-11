import { AccountNotFoundError } from '../../domain/errors.js';
import type { StatementPage } from '../ports/transaction-repository.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface GetStatementInput {
  readonly accountId: string;
  readonly limit: number;
  readonly cursor?: string;
}

export class GetStatement {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: GetStatementInput): Promise<StatementPage> {
    return this.uow.run(async ({ accounts, transactions }) => {
      const account = await accounts.findById(input.accountId);
      if (!account) {
        throw new AccountNotFoundError(input.accountId);
      }
      const query: { accountId: string; limit: number; cursor?: string } = {
        accountId: input.accountId,
        limit: input.limit,
      };
      if (input.cursor !== undefined) {
        query.cursor = input.cursor;
      }
      return transactions.statementOf(query);
    });
  }
}
