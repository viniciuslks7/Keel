import type { PoolClient } from 'pg';
import type { OutboxRepository } from '../../../application/ports/outbox-repository.js';
import type { DomainEvent, EventEnvelope } from '../../../domain/events.js';

interface OutboxRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

export class PostgresOutboxRepository implements OutboxRepository {
  constructor(private readonly client: PoolClient) {}

  async add(event: DomainEvent): Promise<void> {
    const { id, occurredAt, type, ...payload } = event;
    await this.client.query(
      `INSERT INTO outbox (id, type, payload, occurred_at)
       VALUES ($1, $2, $3, $4)`,
      [id, type, JSON.stringify(payload), occurredAt],
    );
  }

  async pullUnpublished(limit: number): Promise<DomainEvent[]> {
    const result = await this.client.query<OutboxRow>(
      `SELECT id, type, payload, occurred_at
       FROM outbox
       WHERE published_at IS NULL
       ORDER BY occurred_at, id
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return result.rows.map(toEvent);
  }

  async markPublished(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.client.query('UPDATE outbox SET published_at = now() WHERE id = ANY($1::uuid[])', [
      [...ids],
    ]);
  }
}

function toEvent(row: OutboxRow): DomainEvent {
  const envelope: EventEnvelope = { id: row.id, occurredAt: row.occurred_at };
  return { ...envelope, type: row.type, ...row.payload } as DomainEvent;
}
