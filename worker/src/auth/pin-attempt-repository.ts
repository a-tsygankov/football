import type { RoomId } from '@fc26/shared'

export interface PinAttempt {
  roomId: RoomId
  ip: string
  attempts: number
  lockedUntil: number | null
}

export interface IPinAttemptRepository {
  get(roomId: RoomId, ip: string): Promise<PinAttempt | null>
  upsert(attempt: PinAttempt): Promise<void>
  clear(roomId: RoomId, ip: string): Promise<void>
}

export class InMemoryPinAttemptRepository implements IPinAttemptRepository {
  private readonly rows = new Map<string, PinAttempt>()

  async get(roomId: RoomId, ip: string): Promise<PinAttempt | null> {
    return this.rows.get(key(roomId, ip)) ?? null
  }

  async upsert(attempt: PinAttempt): Promise<void> {
    this.rows.set(key(attempt.roomId, attempt.ip), attempt)
  }

  async clear(roomId: RoomId, ip: string): Promise<void> {
    this.rows.delete(key(roomId, ip))
  }
}

interface PinAttemptRow {
  room_id: string
  ip: string
  attempts: number
  locked_until: number | null
}

export class D1PinAttemptRepository implements IPinAttemptRepository {
  constructor(private readonly db: D1Database) {}

  async get(roomId: RoomId, ip: string): Promise<PinAttempt | null> {
    const row = await this.db
      .prepare(`SELECT * FROM pin_attempts WHERE room_id = ? AND ip = ?`)
      .bind(roomId, ip)
      .first<PinAttemptRow>()
    if (!row) return null
    return {
      roomId: row.room_id as RoomId,
      ip: row.ip,
      attempts: row.attempts,
      lockedUntil: row.locked_until,
    }
  }

  async upsert(attempt: PinAttempt): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO pin_attempts (room_id, ip, attempts, locked_until)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(room_id, ip) DO UPDATE
         SET attempts = excluded.attempts,
             locked_until = excluded.locked_until`,
      )
      .bind(attempt.roomId, attempt.ip, attempt.attempts, attempt.lockedUntil)
      .run()
  }

  async clear(roomId: RoomId, ip: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM pin_attempts WHERE room_id = ? AND ip = ?`)
      .bind(roomId, ip)
      .run()
  }
}

function key(roomId: RoomId, ip: string): string {
  return `${roomId}:${ip}`
}
