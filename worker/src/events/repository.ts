import { EventId, RoomId, type PersistedGameEvent } from '@fc26/shared'

export interface IGameEventRepository {
  insert(event: PersistedGameEvent): Promise<void>
  listByRoom(roomId: string): Promise<ReadonlyArray<PersistedGameEvent>>
  /**
   * One-shot migration helper used by the stored-squad repair route.
   * Rewrites `home.clubId` / `away.clubId` inside every `game_recorded`
   * payload whose current value appears in `idRemap`. Events are
   * append-only by architecture, so this is intentionally scoped to the
   * one-shot repair path and must never be called during normal game
   * flow. Returns the number of event payloads modified.
   */
  remapClubIdsInPayloads(idRemap: ReadonlyMap<number, number>): Promise<number>
}

function remapGameRecordedPayload(
  payload: PersistedGameEvent['payload'],
  idRemap: ReadonlyMap<number, number>,
): { readonly payload: PersistedGameEvent['payload']; readonly changed: boolean } {
  if (payload.type !== 'game_recorded') return { payload, changed: false }
  const nextHomeClubId = idRemap.get(payload.home.clubId) ?? payload.home.clubId
  const nextAwayClubId = idRemap.get(payload.away.clubId) ?? payload.away.clubId
  if (nextHomeClubId === payload.home.clubId && nextAwayClubId === payload.away.clubId) {
    return { payload, changed: false }
  }
  return {
    payload: {
      ...payload,
      home: { ...payload.home, clubId: nextHomeClubId },
      away: { ...payload.away, clubId: nextAwayClubId },
    },
    changed: true,
  }
}

export class InMemoryGameEventRepository implements IGameEventRepository {
  readonly events: PersistedGameEvent[] = []

  async insert(event: PersistedGameEvent): Promise<void> {
    this.events.push(event)
  }

  async listByRoom(roomId: string): Promise<ReadonlyArray<PersistedGameEvent>> {
    return this.events.filter((event) => event.roomId === roomId)
  }

  async remapClubIdsInPayloads(idRemap: ReadonlyMap<number, number>): Promise<number> {
    if (idRemap.size === 0) return 0
    let changes = 0
    for (let i = 0; i < this.events.length; i += 1) {
      const event = this.events[i]!
      const { payload, changed } = remapGameRecordedPayload(event.payload, idRemap)
      if (!changed) continue
      this.events[i] = { ...event, payload }
      changes += 1
    }
    return changes
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

  async remapClubIdsInPayloads(idRemap: ReadonlyMap<number, number>): Promise<number> {
    if (idRemap.size === 0) return 0
    // D1 has no JSON_SET helper we can rely on across environments, and
    // the payload schema is richer than a single column update anyway.
    // Fetch every `game_recorded` row, rewrite in memory, UPDATE per row
    // that actually changed. Room-scoped payloads are small and this
    // route is one-shot, so the extra round-trips are fine.
    const result = await this.db
      .prepare(
        `SELECT id, payload FROM game_events WHERE event_type = 'game_recorded'`,
      )
      .all<{ id: string; payload: string }>()
    let changes = 0
    for (const row of result.results ?? []) {
      const payload = JSON.parse(row.payload) as PersistedGameEvent['payload']
      const { payload: next, changed } = remapGameRecordedPayload(payload, idRemap)
      if (!changed) continue
      await this.db
        .prepare('UPDATE game_events SET payload = ? WHERE id = ?')
        .bind(JSON.stringify(next), row.id)
        .run()
      changes += 1
    }
    return changes
  }
}
