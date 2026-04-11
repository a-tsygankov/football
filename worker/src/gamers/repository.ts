import { type Gamer, GamerId, RoomId, type RoomId as RoomIdType } from '@fc26/shared'

export interface IGamerRepository {
  insert(gamer: Gamer): Promise<void>
  listByRoom(roomId: RoomIdType): Promise<ReadonlyArray<Gamer>>
  get(roomId: RoomIdType, gamerId: GamerId): Promise<Gamer | null>
  update(gamer: Gamer): Promise<void>
}

export class InMemoryGamerRepository implements IGamerRepository {
  private readonly rows = new Map<GamerId, Gamer>()

  async insert(gamer: Gamer): Promise<void> {
    if (this.rows.has(gamer.id)) {
      throw new Error(`gamer ${gamer.id} already exists`)
    }
    this.rows.set(gamer.id, gamer)
  }

  async listByRoom(roomId: RoomIdType): Promise<ReadonlyArray<Gamer>> {
    return [...this.rows.values()]
      .filter((row) => row.roomId === roomId)
      .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
  }

  async get(roomId: RoomIdType, gamerId: GamerId): Promise<Gamer | null> {
    const gamer = this.rows.get(gamerId) ?? null
    if (!gamer || gamer.roomId !== roomId) return null
    return gamer
  }

  async update(gamer: Gamer): Promise<void> {
    if (!this.rows.has(gamer.id)) {
      throw new Error(`gamer ${gamer.id} not found`)
    }
    this.rows.set(gamer.id, gamer)
  }
}

interface GamerRow {
  id: string
  room_id: string
  name: string
  rating: number
  active: number
  avatar_url: string | null
  created_at: number
  updated_at: number
}

function rowToGamer(row: GamerRow): Gamer {
  return {
    id: GamerId(row.id),
    roomId: RoomId(row.room_id),
    name: row.name,
    rating: row.rating,
    active: row.active === 1,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class D1GamerRepository implements IGamerRepository {
  constructor(private readonly db: D1Database) {}

  async insert(gamer: Gamer): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO gamers
           (id, room_id, name, rating, active, avatar_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        gamer.id,
        gamer.roomId,
        gamer.name,
        gamer.rating,
        gamer.active ? 1 : 0,
        gamer.avatarUrl,
        gamer.createdAt,
        gamer.updatedAt,
      )
      .run()
  }

  async listByRoom(roomId: RoomIdType): Promise<ReadonlyArray<Gamer>> {
    const result = await this.db
      .prepare(
        `SELECT * FROM gamers
         WHERE room_id = ?
         ORDER BY created_at ASC, name COLLATE NOCASE ASC`,
      )
      .bind(roomId)
      .all<GamerRow>()
    return (result.results ?? []).map(rowToGamer)
  }

  async get(roomId: RoomIdType, gamerId: GamerId): Promise<Gamer | null> {
    const row = await this.db
      .prepare(`SELECT * FROM gamers WHERE room_id = ? AND id = ?`)
      .bind(roomId, gamerId)
      .first<GamerRow>()
    return row ? rowToGamer(row) : null
  }

  async update(gamer: Gamer): Promise<void> {
    await this.db
      .prepare(
        `UPDATE gamers
         SET name = ?, rating = ?, active = ?, avatar_url = ?, updated_at = ?
         WHERE id = ? AND room_id = ?`,
      )
      .bind(
        gamer.name,
        gamer.rating,
        gamer.active ? 1 : 0,
        gamer.avatarUrl,
        gamer.updatedAt,
        gamer.id,
        gamer.roomId,
      )
      .run()
  }
}
