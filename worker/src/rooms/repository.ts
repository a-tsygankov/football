import { type Room, RoomId, type RoomSummary } from '@fc26/shared'

export interface IRoomRepository {
  insert(room: Room): Promise<void>
  get(id: RoomId): Promise<Room | null>
  getByNameKey(nameKey: string): Promise<Room | null>
  update(room: Room): Promise<void>
}

export function toRoomSummary(room: Room): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    avatarUrl: room.avatarUrl,
    hasPin: Boolean(room.pinHash),
    defaultSelectionStrategy: room.defaultSelectionStrategy,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  }
}

export class InMemoryRoomRepository implements IRoomRepository {
  private readonly rows = new Map<RoomId, Room>()

  async insert(room: Room): Promise<void> {
    if (this.rows.has(room.id)) {
      throw new Error(`room ${room.id} already exists`)
    }
    this.rows.set(room.id, room)
  }

  async get(id: RoomId): Promise<Room | null> {
    return this.rows.get(id) ?? null
  }

  async getByNameKey(nameKey: string): Promise<Room | null> {
    return [...this.rows.values()].find((room) => room.nameKey === nameKey) ?? null
  }

  async update(room: Room): Promise<void> {
    if (!this.rows.has(room.id)) {
      throw new Error(`room ${room.id} not found`)
    }
    this.rows.set(room.id, room)
  }
}

interface RoomRow {
  id: string
  name: string
  name_key: string
  avatar_url: string | null
  pin_hash: string | null
  pin_salt: string | null
  default_selection_strategy: string
  created_at: number
  updated_at: number
}

function rowToRoom(row: RoomRow): Room {
  return {
    id: RoomId(row.id),
    name: row.name,
    nameKey: row.name_key,
    avatarUrl: row.avatar_url,
    pinHash: row.pin_hash,
    pinSalt: row.pin_salt,
    defaultSelectionStrategy: row.default_selection_strategy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class D1RoomRepository implements IRoomRepository {
  constructor(private readonly db: D1Database) {}

  async insert(room: Room): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO rooms
           (id, name, name_key, avatar_url, pin_hash, pin_salt, default_selection_strategy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        room.id,
        room.name,
        room.nameKey,
        room.avatarUrl,
        room.pinHash,
        room.pinSalt,
        room.defaultSelectionStrategy,
        room.createdAt,
        room.updatedAt,
      )
      .run()
  }

  async get(id: RoomId): Promise<Room | null> {
    const row = await this.db
      .prepare(`SELECT * FROM rooms WHERE id = ?`)
      .bind(id)
      .first<RoomRow>()
    return row ? rowToRoom(row) : null
  }

  async getByNameKey(nameKey: string): Promise<Room | null> {
    const row = await this.db
      .prepare(`SELECT * FROM rooms WHERE name_key = ?`)
      .bind(nameKey)
      .first<RoomRow>()
    return row ? rowToRoom(row) : null
  }

  async update(room: Room): Promise<void> {
    await this.db
      .prepare(
        `UPDATE rooms
         SET name = ?, name_key = ?, avatar_url = ?, pin_hash = ?, pin_salt = ?, default_selection_strategy = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        room.name,
        room.nameKey,
        room.avatarUrl,
        room.pinHash,
        room.pinSalt,
        room.defaultSelectionStrategy,
        room.updatedAt,
        room.id,
      )
      .run()
  }
}
