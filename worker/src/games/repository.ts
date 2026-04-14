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
            home_gamer_ids_json, away_gamer_ids_json, selection_strategy_id,
            random_seed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
             away_gamer_ids_json = ?, selection_strategy_id = ?, random_seed = ?, updated_at = ?
         WHERE id = ? AND room_id = ? AND game_night_id = ?`,
      )
      .bind(
        game.status,
        game.allocationMode,
        game.format,
        JSON.stringify(game.homeGamerIds),
        JSON.stringify(game.awayGamerIds),
        game.selectionStrategyId,
        game.randomSeed,
        game.updatedAt,
        game.id,
        game.roomId,
        game.gameNightId,
      )
      .run()
  }
}
