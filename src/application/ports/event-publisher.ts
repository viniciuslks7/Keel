import type { DomainEvent } from '../../domain/events.js';

/**
 * Delivers events to the outside world (a log, a broker, a webhook). The relay
 * publishes before marking events as sent, so delivery is at-least-once: a
 * crash after publishing but before marking simply re-delivers.
 */
export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}
