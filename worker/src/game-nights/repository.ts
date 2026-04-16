import {
  type GameNight,
  GameNightId,
  type GameNightActiveGamer,
  GamerId,
  RoomId,
  type RoomId as RoomIdType,
} from '@fc26/shared'

export interface IGameNightRepository {
  getActive(roomId: RoomIdType): Promise<GameNight | null>
  listActiveGamers(gameNightId: GameNightId): Promise<ReadonlyArray<GameNightActiveGamer>>
  create(
    gameNight: GameNight,
    activeGamers: ReadonlyArray<GameNightActiveGamer>,
  ): Promise<void>
  complete(gameNightId: GameNightId, endedAt: number): Promise<void>
  replaceActiveGamers(
    gameNightId: GameNightId,
    roomId: RoomIdType,
    gamerIds: ReadonlyArray<GamerId>,
    now: number,
  ): Promise<ReadonlyArray<GameNightActiveGamer>>
  touchLastGameAt(gameNightId: GameNightId, at: number): Promise<void>
}

export class InMemoryGameNightRepository implements IGameNightRepository {
  private readonly gameNights = new Map<GameNightId, GameNight>()
  private readonly activeGamers = new Map<GameNightId, GameNightActiveGamer[]>()

  async getActive(roomId: RoomIdType): Promise<GameNight | null> {
    return (
      [...this.gameNights.values()].find(
        (gameNight) => gameNight.roomId === roomId && gameNight.status === 'active',
      ) ?? null
    )
  }

  async listActiveGamers(
    gameNightId: GameNightId,
  ): Promise<ReadonlyArray<GameNightActiveGamer>> {
    return [...(this.activeGamers.get(gameNightId) ?? [])].sort(
      (a, b) => a.joinedAt - b.joinedAt,
    )
  }

  async create(
    gameNight: GameNight,
    activeGamers: ReadonlyArray<GameNightActiveGamer>,
  ): Promise<void> {
    const existing = await this.getActive(gameNight.roomId)
    if (existing) {
      throw new Error(`room ${gameNight.roomId} already has an active game night`)
    }
    this.gameNights.set(gameNight.id, gameNight)
    this.activeGamers.set(gameNight.id, [...activeGamers])
  }

  async complete(gameNightId: GameNightId, endedAt: number): Promise<void> {
    const current = this.gameNights.get(gameNightId)
    if (!current) return
    this.gameNights.set(gameNightId, {
      ...current,
      status: 'completed',
      endedAt,
      updatedAt: endedAt,
    })
  }

  async replaceActiveGamers(
    gameNightId: GameNightId,
    roomId: RoomIdType,
    gamerIds: ReadonlyArray<GamerId>,
    now: number,
  ): Promise<ReadonlyArray<GameNightActiveGamer>> {
    const existing = new Map(
      (this.activeGamers.get(gameNightId) ?? []).map((item) => [item.gamerId, item]),
    )
    const next = gamerIds.map((gamerId) => {
      const previous = existing.get(gamerId)
      return {
        gameNightId,
        roomId,
        gamerId,
        joinedAt: previous?.joinedAt ?? now,
        updatedAt: now,
      }
    })
    this.activeGamers.set(gameNightId, next)
    const current = this.gameNights.get(gameNightId)
    if (current) {
      this.gameNights.set(gameNightId, { ...current, updatedAt: now })
    }
    return next
  }

  async touchLastGameAt(gameNightId: GameNightId, at: number): Promise<void> {
    const current = this.gameNights.get(gameNightId)
    if (!current) return
    this.gameNights.set(gameNightId, { ...current, lastGameAt: at, updatedAt: at })
  }
}

interface GameNightRow {
  id: string
  room_id: string
  status: 'active' | 'completed'
  started_at: number
  ended_at: number | null
  last_game_at: number | null
  created_at: number
  updated_at: number
}

interface GameNightActiveGamerRow {
  game_night_id: string
  room_id: string
  gamer_id: string
  joined_at: number
  updated_at: number
}

function rowToGameNight(row: GameNightRow): GameNight {
  return {
    id: GameNightId(row.id),
    roomId: RoomId(row.room_id),
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    lastGameAt: row.last_game_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToGameNightActiveGamer(
  row: GameNightActiveGamerRow,
): GameNightActiveGamer {
  return {
    gameNightId: GameNightId(row.game_night_id),
    roomId: RoomId(row.room_id),
    gamerId: GamerId(row.gamer_id),
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
  }
}

export class D1GameNightRepository implements IGameNightRepository {
  constructor(private readonly db: D1Database) {}

  async getActive(roomId: RoomIdType): Promise<GameNight | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM game_nights
         WHERE room_id = ? AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .bind(roomId)
      .first<GameNightRow>()
    return row ? rowToGameNight(row) : null
  }

  async listActiveGamers(
    gameNightId: GameNightId,
  ): Promise<ReadonlyArray<GameNightActiveGamer>> {
    const result = await this.db
      .prepare(
        `SELECT gnag.game_night_id, gn.room_id, gnag.gamer_id, gnag.joined_at, gnag.updated_at
         FROM game_night_active_gamers gnag
         INNER JOIN game_nights gn ON gn.id = gnag.game_night_id
         WHERE gnag.game_night_id = ?
         ORDER BY gnag.joined_at ASC, gnag.gamer_id ASC`,
      )
      .bind(gameNightId)
      .all<GameNightActiveGamerRow>()
    return (result.results ?? []).map(rowToGameNightActiveGamer)
  }

  async create(
    gameNight: GameNight,
    activeGamers: ReadonlyArray<GameNightActiveGamer>,
  ): Promise<void> {
    const stmts = [
      this.db
        .prepare(
          `INSERT INTO game_nights
             (id, room_id, status, started_at, ended_at, last_game_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          gameNight.id,
          gameNight.roomId,
          gameNight.status,
          gameNight.startedAt,
          gameNight.endedAt,
          gameNight.lastGameAt,
          gameNight.createdAt,
          gameNight.updatedAt,
        ),
      ...activeGamers.map((activeGamer) =>
        this.db
          .prepare(
            `INSERT INTO game_night_active_gamers
               (game_night_id, gamer_id, joined_at, updated_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(
            activeGamer.gameNightId,
            activeGamer.gamerId,
            activeGamer.joinedAt,
            activeGamer.updatedAt,
          ),
      ),
    ]
    await this.db.batch(stmts)
  }

  async complete(gameNightId: GameNightId, endedAt: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE game_nights
         SET status = 'completed', ended_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(endedAt, endedAt, gameNightId)
      .run()
  }

  async replaceActiveGamers(
    gameNightId: GameNightId,
    roomId: RoomIdType,
    gamerIds: ReadonlyArray<GamerId>,
    now: number,
  ): Promise<ReadonlyArray<GameNightActiveGamer>> {
    const existing = await this.listActiveGamers(gameNightId)
    const existingIds = new Set(existing.map((item) => item.gamerId))
    const nextIds = new Set(gamerIds)

    const statements = []

    for (const item of existing) {
      if (!nextIds.has(item.gamerId)) {
        statements.push(
          this.db
            .prepare(
              `DELETE FROM game_night_active_gamers
               WHERE game_night_id = ? AND gamer_id = ?`,
            )
            .bind(gameNightId, item.gamerId),
        )
        continue
      }

      statements.push(
        this.db
          .prepare(
            `UPDATE game_night_active_gamers
             SET updated_at = ?
             WHERE game_night_id = ? AND gamer_id = ?`,
          )
          .bind(now, gameNightId, item.gamerId),
      )
    }

    for (const gamerId of gamerIds) {
      if (existingIds.has(gamerId)) continue
      statements.push(
        this.db
          .prepare(
            `INSERT INTO game_night_active_gamers
               (game_night_id, gamer_id, joined_at, updated_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(gameNightId, gamerId, now, now),
      )
    }

    statements.push(
      this.db
        .prepare(
          `UPDATE game_nights
           SET updated_at = ?
           WHERE id = ? AND room_id = ?`,
        )
        .bind(now, gameNightId, roomId),
    )

    if (statements.length > 0) {
      await this.db.batch(statements)
    }

    return this.listActiveGamers(gameNightId)
  }

  async touchLastGameAt(gameNightId: GameNightId, at: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE game_nights
         SET last_game_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(at, at, gameNightId)
      .run()
  }
}
