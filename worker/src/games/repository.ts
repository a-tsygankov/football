import {
  type CurrentGame,
  GameId,
  GameNightId,
  GamerId,
  RoomId,
  type GameNightId as GameNightIdType,
} from '@fc26/shared'

export interface IGameRepository {
  getActive(gameNightId: GameNightIdType): Promise<CurrentGame | null>
  create(game: CurrentGame): Promise<void>
  update(game: CurrentGame): Promise<void>
  /**
   * One-shot migration helper used by the stored-squad repair route.
   * Rewrites every `home_club_id` / `away_club_id` cell that appears as a
   * key in `idRemap` with the remap target. Returns the number of rows
   * modified so the repair summary can report it. Safe on repeat calls —
   * already-canonical rows are untouched.
   */
  remapClubIds(idRemap: ReadonlyMap<number, number>): Promise<number>
}

export class InMemoryGameRepository implements IGameRepository {
  private readonly games = new Map<GameId, CurrentGame>()

  async getActive(gameNightId: GameNightIdType): Promise<CurrentGame | null> {
    return (
      [...this.games.values()].find(
        (game) => game.gameNightId === gameNightId && game.status === 'active',
      ) ?? null
    )
  }

  async create(game: CurrentGame): Promise<void> {
    const existing = await this.getActive(game.gameNightId)
    if (existing) {
      throw new Error(`game night ${game.gameNightId} already has an active game`)
    }
    this.games.set(game.id, game)
  }

  async update(game: CurrentGame): Promise<void> {
    if (!this.games.has(game.id)) {
      throw new Error(`game ${game.id} not found`)
    }
    this.games.set(game.id, game)
  }

  async remapClubIds(idRemap: ReadonlyMap<number, number>): Promise<number> {
    if (idRemap.size === 0) return 0
    let changes = 0
    for (const [id, game] of this.games) {
      const nextHome =
        game.homeClubId !== null ? idRemap.get(game.homeClubId) ?? game.homeClubId : null
      const nextAway =
        game.awayClubId !== null ? idRemap.get(game.awayClubId) ?? game.awayClubId : null
      if (nextHome === game.homeClubId && nextAway === game.awayClubId) continue
      if (nextHome !== game.homeClubId) changes += 1
      if (nextAway !== game.awayClubId) changes += 1
      this.games.set(id, { ...game, homeClubId: nextHome, awayClubId: nextAway })
    }
    return changes
  }
}

interface GameRow {
  id: string
  room_id: string
  game_night_id: string
  status: 'active' | 'recorded' | 'interrupted' | 'voided'
  allocation_mode: 'manual' | 'random'
  format: '1v1' | '1v2' | '2v1' | '2v2'
  home_gamer_ids_json: string
  away_gamer_ids_json: string
  home_club_id: number | null
  away_club_id: number | null
  selection_strategy_id: string
  random_seed: number | null
  created_at: number
  updated_at: number
}

function parseGamerIds(value: string): GamerId[] {
  const parsed = JSON.parse(value) as string[]
  return parsed.map((item) => GamerId(item))
}

function rowToCurrentGame(row: GameRow): CurrentGame {
  return {
    id: GameId(row.id),
    roomId: RoomId(row.room_id),
    gameNightId: GameNightId(row.game_night_id),
    status: row.status,
    allocationMode: row.allocation_mode,
    format: row.format,
    homeGamerIds: parseGamerIds(row.home_gamer_ids_json),
    awayGamerIds: parseGamerIds(row.away_gamer_ids_json),
    homeClubId: row.home_club_id,
    awayClubId: row.away_club_id,
    selectionStrategyId: row.selection_strategy_id,
    randomSeed: row.random_seed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class D1GameRepository implements IGameRepository {
  constructor(private readonly db: D1Database) {}

  async getActive(gameNightId: GameNightIdType): Promise<CurrentGame | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM games
         WHERE game_night_id = ? AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .bind(gameNightId)
      .first<GameRow>()
    return row ? rowToCurrentGame(row) : null
  }

  async create(game: CurrentGame): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO games
           (id, room_id, game_night_id, status, allocation_mode, format,
            home_gamer_ids_json, away_gamer_ids_json, home_club_id, away_club_id, selection_strategy_id,
            random_seed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      )
      .bind(
        game.id,
        game.roomId,
        game.gameNightId,
        game.status,
        game.allocationMode,
        game.format,
        JSON.stringify(game.homeGamerIds),
        JSON.stringify(game.awayGamerIds),
        game.homeClubId,
        game.awayClubId,
        game.selectionStrategyId,
        game.randomSeed,
        game.createdAt,
        game.updatedAt,
      )
      .run()
  }

  async update(game: CurrentGame): Promise<void> {
    await this.db
      .prepare(
        `UPDATE games
         SET status = ?, allocation_mode = ?, format = ?, home_gamer_ids_json = ?,
             away_gamer_ids_json = ?, home_club_id = ?, away_club_id = ?,
             selection_strategy_id = ?, random_seed = ?, updated_at = ?
         WHERE id = ? AND room_id = ? AND game_night_id = ?`,
      )
      .bind(
        game.status,
        game.allocationMode,
        game.format,
        JSON.stringify(game.homeGamerIds),
        JSON.stringify(game.awayGamerIds),
        game.homeClubId,
        game.awayClubId,
        game.selectionStrategyId,
        game.randomSeed,
        game.updatedAt,
        game.id,
        game.roomId,
        game.gameNightId,
      )
      .run()
  }

  async remapClubIds(idRemap: ReadonlyMap<number, number>): Promise<number> {
    if (idRemap.size === 0) return 0
    // One UPDATE per (from → to) pair keeps the SQL simple and avoids
    // building a CASE statement that some D1 drivers choke on. Each
    // statement hits at most two columns, and we count affected rows
    // across home/away independently so the repair summary matches the
    // "X historical references rewritten" framing the UI surfaces.
    let totalChanges = 0
    for (const [from, to] of idRemap) {
      if (from === to) continue
      const homeResult = await this.db
        .prepare('UPDATE games SET home_club_id = ? WHERE home_club_id = ?')
        .bind(to, from)
        .run()
      const awayResult = await this.db
        .prepare('UPDATE games SET away_club_id = ? WHERE away_club_id = ?')
        .bind(to, from)
        .run()
      totalChanges += (homeResult.meta?.changes ?? 0) + (awayResult.meta?.changes ?? 0)
    }
    return totalChanges
  }
}
