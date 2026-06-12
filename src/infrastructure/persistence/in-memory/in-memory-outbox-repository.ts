import type { OutboxRepository } from '../../../application/ports/outbox-repository.js';
import type { DomainEvent } from '../../../domain/events.js';
import type { InMemoryStore } from './in-memory-store.js';

export class InMemoryOutboxRepository implements OutboxRepository {
  constructor(private readonly store: InMemoryStore) {}

  async add(event: DomainEvent): Promise<void> {
    this.store.outbox.push({ event, published: false });
  }

  async pullUnpublished(limit: number): Promise<DomainEvent[]> {
    return this.store.outbox
      .filter((record) => !record.published)
      .slice(0, limit)
      .map((record) => record.event);
  }

  async markPublished(ids: readonly string[]): Promise<void> {
    const wanted = new Set(ids);
    for (const record of this.store.outbox) {
      if (wanted.has(record.event.id)) {
        record.published = true;
      }
    }
  }
}
