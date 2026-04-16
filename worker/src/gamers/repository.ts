import { type Gamer, GamerId, RoomId, type RoomId as RoomIdType } from '@fc26/shared'

export interface StoredGamer extends Gamer {
  nameKey: string
  pinHash: string | null
  pinSalt: string | null
}

export interface IGamerRepository {
  insert(gamer: StoredGamer): Promise<void>
  listByRoom(roomId: RoomIdType): Promise<ReadonlyArray<StoredGamer>>
  get(roomId: RoomIdType, gamerId: GamerId): Promise<StoredGamer | null>
  getByNameKey(nameKey: string): Promise<StoredGamer | null>
  update(gamer: StoredGamer): Promise<void>
}

export function toPublicGamer(gamer: StoredGamer): Gamer {
  return {
    id: gamer.id,
    roomId: gamer.roomId,
    name: gamer.name,
    rating: gamer.rating,
    active: gamer.active,
    hasPin: gamer.hasPin,
    avatarUrl: gamer.avatarUrl,
    createdAt: gamer.createdAt,
    updatedAt: gamer.updatedAt,
  }
}

export class InMemoryGamerRepository implements IGamerRepository {
  private readonly rows = new Map<GamerId, StoredGamer>()

  async insert(gamer: StoredGamer): Promise<void> {
    if (this.rows.has(gamer.id)) {
      throw new Error(`gamer ${gamer.id} already exists`)
    }
    this.rows.set(gamer.id, gamer)
  }

  async listByRoom(roomId: RoomIdType): Promise<ReadonlyArray<StoredGamer>> {
    return [...this.rows.values()]
      .filter((row) => row.roomId === roomId)
      .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
  }

  async get(roomId: RoomIdType, gamerId: GamerId): Promise<StoredGamer | null> {
    const gamer = this.rows.get(gamerId) ?? null
    if (!gamer || gamer.roomId !== roomId) return null
    return gamer
  }

  async getByNameKey(nameKey: string): Promise<StoredGamer | null> {
    return [...this.rows.values()].find((gamer) => gamer.nameKey === nameKey) ?? null
  }

  async update(gamer: StoredGamer): Promise<void> {
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
  name_key: string
  rating: number
  active: number
  pin_hash: string | null
  pin_salt: string | null
  avatar_url: string | null
  created_at: number
  updated_at: number
}

function rowToGamer(row: GamerRow): StoredGamer {
  return {
    id: GamerId(row.id),
    roomId: RoomId(row.room_id),
    name: row.name,
    nameKey: row.name_key,
    rating: row.rating,
    active: row.active === 1,
    hasPin: Boolean(row.pin_hash),
    pinHash: row.pin_hash,
    pinSalt: row.pin_salt,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class D1GamerRepository implements IGamerRepository {
  constructor(private readonly db: D1Database) {}

  async insert(gamer: StoredGamer): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO gamers
           (id, room_id, name, name_key, rating, active, pin_hash, pin_salt, avatar_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        gamer.id,
        gamer.roomId,
        gamer.name,
        gamer.nameKey,
        gamer.rating,
        gamer.active ? 1 : 0,
        gamer.pinHash,
        gamer.pinSalt,
        gamer.avatarUrl,
        gamer.createdAt,
        gamer.updatedAt,
      )
      .run()
  }

  async listByRoom(roomId: RoomIdType): Promise<ReadonlyArray<StoredGamer>> {
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

  async get(roomId: RoomIdType, gamerId: GamerId): Promise<StoredGamer | null> {
    const row = await this.db
      .prepare(`SELECT * FROM gamers WHERE room_id = ? AND id = ?`)
      .bind(roomId, gamerId)
      .first<GamerRow>()
    return row ? rowToGamer(row) : null
  }

  async getByNameKey(nameKey: string): Promise<StoredGamer | null> {
    const row = await this.db
      .prepare(`SELECT * FROM gamers WHERE name_key = ?`)
      .bind(nameKey)
      .first<GamerRow>()
    return row ? rowToGamer(row) : null
  }

  async update(gamer: StoredGamer): Promise<void> {
    await this.db
      .prepare(
        `UPDATE gamers
         SET name = ?, name_key = ?, rating = ?, active = ?, pin_hash = ?, pin_salt = ?, avatar_url = ?, updated_at = ?
         WHERE id = ? AND room_id = ?`,
      )
      .bind(
        gamer.name,
        gamer.nameKey,
        gamer.rating,
        gamer.active ? 1 : 0,
        gamer.pinHash,
        gamer.pinSalt,
        gamer.avatarUrl,
        gamer.updatedAt,
        gamer.id,
        gamer.roomId,
      )
      .run()
  }
}
