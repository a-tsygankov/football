import { EventId, RoomId, type PersistedGameEvent } from '@fc26/shared'

export interface IGameEventRepository {
  insert(event: PersistedGameEvent): Promise<void>
  listByRoom(roomId: string): Promise<ReadonlyArray<PersistedGameEvent>>
}

export class InMemoryGameEventRepository implements IGameEventRepository {
  readonly events: PersistedGameEvent[] = []

  async insert(event: PersistedGameEvent): Promise<void> {
    this.events.push(event)
  }

  async listByRoom(roomId: string): Promise<ReadonlyArray<PersistedGameEvent>> {
    return this.events.filter((event) => event.roomId === roomId)
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

  async listByRoom(roomId: string): Promise<ReadonlyArray<PersistedGameEvent>> {
    const result = await this.db
      .prepare(
        `SELECT id, room_id, event_type, payload, schema_version, correlation_id, occurred_at, recorded_at
           FROM game_events
          WHERE room_id = ?
          ORDER BY occurred_at ASC, recorded_at ASC`,
      )
      .bind(roomId)
      .all<{
        id: string
        room_id: string
        event_type: PersistedGameEvent['eventType']
        payload: string
        schema_version: number
        correlation_id: string | null
        occurred_at: number
        recorded_at: number
      }>()

    return (result.results ?? []).map((row) => ({
      id: EventId(row.id),
      roomId: RoomId(row.room_id),
      eventType: row.event_type,
      payload: JSON.parse(row.payload) as PersistedGameEvent['payload'],
      schemaVersion: row.schema_version,
      correlationId: row.correlation_id,
      occurredAt: row.occurred_at,
      recordedAt: row.recorded_at,
    }))
  }
}
