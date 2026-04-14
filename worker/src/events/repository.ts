import type { PersistedGameEvent } from '@fc26/shared'

export interface IGameEventRepository {
  insert(event: PersistedGameEvent): Promise<void>
}

export class InMemoryGameEventRepository implements IGameEventRepository {
  readonly events: PersistedGameEvent[] = []

  async insert(event: PersistedGameEvent): Promise<void> {
    this.events.push(event)
  }
}

export class D1GameEventRepository implements IGameEventRepository {
  constructor(private readonly db: D1Database) {}

  async insert(event: PersistedGameEvent): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO game_events
           (id, room_id, event_type, payload, schema_version, correlation_id, occurred_at, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        event.roomId,
        event.eventType,
        JSON.stringify(event.payload),
        event.schemaVersion,
        event.correlationId,
        event.occurredAt,
        event.recordedAt,
      )
      .run()
  }
}
