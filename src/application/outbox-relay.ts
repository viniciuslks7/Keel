import type { DomainEvent } from '../domain/events.js';
import type { EventPublisher } from './ports/event-publisher.js';
import type { UnitOfWork } from './ports/unit-of-work.js';

/**
 * Drains the outbox: reads a batch of unpublished events, hands them to the
 * publisher, then marks them published. Pull and mark are separate units of
 * work with the external publish in between, which is what makes delivery
 * at-least-once rather than lost on a publisher failure.
 */
export class OutboxRelay {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly publisher: EventPublisher,
  ) {}

  async drain(batchSize = 100): Promise<DomainEvent[]> {
    const events = await this.uow.run(({ outbox }) => outbox.pullUnpublished(batchSize));
    if (events.length === 0) {
      return [];
    }
    await this.publisher.publish(events);
    await this.uow.run(({ outbox }) => outbox.markPublished(events.map((event) => event.id)));
    return events;
  }
}
