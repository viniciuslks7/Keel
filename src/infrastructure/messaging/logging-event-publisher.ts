import type { EventPublisher } from '../../application/ports/event-publisher.js';
import type { DomainEvent } from '../../domain/events.js';

interface Logger {
  info(payload: Record<string, unknown>, message: string): void;
}

/**
 * The simplest possible publisher: it writes each event to the structured log.
 * In a real deployment this is where a broker (Kafka, SNS, a webhook) would go;
 * swapping it out requires nothing but a different EventPublisher.
 */
export class LoggingEventPublisher implements EventPublisher {
  constructor(private readonly logger: Logger) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      this.logger.info({ event }, `event published: ${event.type}`);
    }
  }
}
