import {
  type Bet,
  BetId,
  GameId,
  GameNightId,
  GamerId,
  RoomId,
  type GameResult,
} from '@fc26/shared'

export interface IBetRepository {
  listByGame(gameId: GameId): Promise<ReadonlyArray<Bet>>
  /**
   * Every unsettled bet of a night. Settlement deletes rows, so this is
   * exactly the set of stakes still at risk — which is what an available
   * balance has to subtract.
   */
  listByGameNight(gameNightId: GameNightId): Promise<ReadonlyArray<Bet>>
  /** Places a bet, replacing any existing bet by the same gamer on the game. */
  upsert(bet: Bet): Promise<void>
  remove(betId: BetId, gameId: GameId): Promise<void>
  /** Called at settlement: the event payload becomes the durable record. */
  deleteByGame(gameId: GameId): Promise<void>
  /** Sweeps bets belonging to a night that ended without resolving a game. */
  deleteByGameNight(gameNightId: GameNightId): Promise<void>
}

export class InMemoryBetRepository implements IBetRepository {
  private readonly bets = new Map<BetId, Bet>()

  async listByGame(gameId: GameId): Promise<ReadonlyArray<Bet>> {
    return [...this.bets.values()]
      .filter((bet) => bet.gameId === gameId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  async listByGameNight(gameNightId: GameNightId): Promise<ReadonlyArray<Bet>> {
    return [...this.bets.values()]
      .filter((bet) => bet.gameNightId === gameNightId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  async upsert(bet: Bet): Promise<void> {
    const existing = [...this.bets.values()].find(
      (item) => item.gameId === bet.gameId && item.gamerId === bet.gamerId,
    )
    if (existing) {
      // Match D1, whose ON CONFLICT updates outcome/stake/updated_at and
      // leaves id and created_at alone. Deleting and re-inserting under the
      // caller's id would give the same bet a different identity here than in
      // production — invisible until something keys off betId, which the bet
      // event log now does.
      this.bets.set(existing.id, {
        ...bet,
        id: existing.id,
        createdAt: existing.createdAt,
      })
      return
    }
    this.bets.set(bet.id, bet)
  }

  async remove(betId: BetId, gameId: GameId): Promise<void> {
    const existing = this.bets.get(betId)
    if (existing && existing.gameId === gameId) this.bets.delete(betId)
  }

  async deleteByGame(gameId: GameId): Promise<void> {
    for (const [id, bet] of this.bets) {
      if (bet.gameId === gameId) this.bets.delete(id)
    }
  }

  async deleteByGameNight(gameNightId: GameNightId): Promise<void> {
    for (const [id, bet] of this.bets) {
      if (bet.gameNightId === gameNightId) this.bets.delete(id)
    }
  }
}

interface BetRow {
  id: string
  room_id: string
  game_night_id: string
  game_id: string
  gamer_id: string
  outcome: GameResult
  stake: number
  created_at: number
  updated_at: number
}

function rowToBet(row: BetRow): Bet {
  return {
    id: BetId(row.id),
    roomId: RoomId(row.room_id),
    gameNightId: GameNightId(row.game_night_id),
    gameId: GameId(row.game_id),
    gamerId: GamerId(row.gamer_id),
    outcome: row.outcome,
    stake: row.stake,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class D1BetRepository implements IBetRepository {
  constructor(private readonly db: D1Database) {}

  async listByGame(gameId: GameId): Promise<ReadonlyArray<Bet>> {
    const result = await this.db
      .prepare('SELECT * FROM bets WHERE game_id = ? ORDER BY created_at ASC')
      .bind(gameId)
      .all<BetRow>()
    return (result.results ?? []).map(rowToBet)
  }

  async listByGameNight(gameNightId: GameNightId): Promise<ReadonlyArray<Bet>> {
    const result = await this.db
      .prepare('SELECT * FROM bets WHERE game_night_id = ? ORDER BY created_at ASC')
      .bind(gameNightId)
      .all<BetRow>()
    return (result.results ?? []).map(rowToBet)
  }

  async upsert(bet: Bet): Promise<void> {
    // `idx_bets_game_gamer` makes (game_id, gamer_id) unique, so a repeat bet
    // updates the existing row in place and keeps its original created_at.
    await this.db
      .prepare(
        `INSERT INTO bets
           (id, room_id, game_night_id, game_id, gamer_id, outcome, stake, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_id, gamer_id) DO UPDATE SET
           outcome = excluded.outcome,
           stake = excluded.stake,
           updated_at = excluded.updated_at`,
      )
      .bind(
        bet.id,
        bet.roomId,
        bet.gameNightId,
        bet.gameId,
        bet.gamerId,
        bet.outcome,
        bet.stake,
        bet.createdAt,
        bet.updatedAt,
      )
      .run()
  }

  async remove(betId: BetId, gameId: GameId): Promise<void> {
    await this.db
      .prepare('DELETE FROM bets WHERE id = ? AND game_id = ?')
      .bind(betId, gameId)
      .run()
  }

  async deleteByGame(gameId: GameId): Promise<void> {
    await this.db.prepare('DELETE FROM bets WHERE game_id = ?').bind(gameId).run()
  }

  async deleteByGameNight(gameNightId: GameNightId): Promise<void> {
    await this.db
      .prepare('DELETE FROM bets WHERE game_night_id = ?')
      .bind(gameNightId)
      .run()
  }
}
