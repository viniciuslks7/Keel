import type { Clock } from './ports/clock.js';
import type { IdGenerator } from './ports/id-generator.js';
import type { UnitOfWork } from './ports/unit-of-work.js';

/**
 * Guarantees one SYSTEM treasury account per supported currency. Idempotent:
 * safe to run on every process start.
 */
export async function ensureSystemAccounts(
  uow: UnitOfWork,
  ids: IdGenerator,
  clock: Clock,
  currencies: readonly string[],
): Promise<void> {
  await uow.run(async ({ accounts }) => {
    for (const currency of currencies) {
      const existing = await accounts.findSystemAccount(currency);
      if (!existing) {
        await accounts.create({
          id: ids.next(),
          ownerName: `treasury:${currency}`,
          currency,
          kind: 'SYSTEM',
          status: 'ACTIVE',
          createdAt: clock.now(),
        });
      }
    }
  });
}
