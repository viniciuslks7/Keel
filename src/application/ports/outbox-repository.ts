import type { DomainEvent } from '../../domain/events.js';

/**
 * Append-only store of domain events. `add` runs inside the same unit of work
 * as the ledger change, so events commit or roll back atomically with it. A
 * relay later reads the unpublished ones and marks them published.
 */
export interface OutboxRepository {
  add(event: DomainEvent): Promise<void>;
  pullUnpublished(limit: number): Promise<DomainEvent[]>;
  markPublished(ids: readonly string[]): Promise<void>;
}
