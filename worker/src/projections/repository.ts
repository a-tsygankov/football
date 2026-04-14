import {
  gamerTeamKey,
  type GameRecordedEvent,
  type GamerPoints,
  type GamerTeamPoints,
  type PersistedGameEvent,
} from '@fc26/shared'

type RecordedGameEnvelope = PersistedGameEvent & { payload: GameRecordedEvent }

export interface IGameProjectionRepository {
  applyRecordedEvent(event: RecordedGameEnvelope): Promise<void>
}

interface GamerPointDelta {
  gamerId: string
  roomId: string
  gamesPlayed: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  lastEventId: string
  updatedAt: number
}

interface GamerTeamPointDelta {
  gamerTeamKey: string
  roomId: string
  members: readonly string[]
  gamesPlayed: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  lastEventId: string
  updatedAt: number
}

export class InMemoryGameProjectionRepository implements IGameProjectionRepository {
  readonly gamerPoints = new Map<string, GamerPoints>()
  readonly gamerTeamPoints = new Map<string, GamerTeamPoints>()

  async applyRecordedEvent(event: RecordedGameEnvelope): Promise<void> {
    for (const delta of buildGamerPointDeltas(event)) {
      const current = this.gamerPoints.get(delta.gamerId)
      this.gamerPoints.set(delta.gamerId, {
        gamerId: delta.gamerId as GamerPoints['gamerId'],
        roomId: delta.roomId as GamerPoints['roomId'],
        gamesPlayed: (current?.gamesPlayed ?? 0) + delta.gamesPlayed,
        wins: (current?.wins ?? 0) + delta.wins,
        draws: (current?.draws ?? 0) + delta.draws,
        losses: (current?.losses ?? 0) + delta.losses,
        goalsFor: (current?.goalsFor ?? 0) + delta.goalsFor,
        goalsAgainst: (current?.goalsAgainst ?? 0) + delta.goalsAgainst,
        lastEventId: delta.lastEventId,
        updatedAt: delta.updatedAt,
      })
    }

    for (const delta of buildGamerTeamPointDeltas(event)) {
      const current = this.gamerTeamPoints.get(delta.gamerTeamKey)
      this.gamerTeamPoints.set(delta.gamerTeamKey, {
        gamerTeamKey: delta.gamerTeamKey as GamerTeamPoints['gamerTeamKey'],
        roomId: delta.roomId as GamerTeamPoints['roomId'],
        members: delta.members as GamerTeamPoints['members'],
        gamesPlayed: (current?.gamesPlayed ?? 0) + delta.gamesPlayed,
        wins: (current?.wins ?? 0) + delta.wins,
        draws: (current?.draws ?? 0) + delta.draws,
        losses: (current?.losses ?? 0) + delta.losses,
        goalsFor: (current?.goalsFor ?? 0) + delta.goalsFor,
        goalsAgainst: (current?.goalsAgainst ?? 0) + delta.goalsAgainst,
        lastEventId: delta.lastEventId,
        updatedAt: delta.updatedAt,
      })
    }
  }
}

export class D1GameProjectionRepository implements IGameProjectionRepository {
  constructor(private readonly db: D1Database) {}

  async applyRecordedEvent(event: RecordedGameEnvelope): Promise<void> {
    const statements = [
      ...buildGamerPointDeltas(event).map((delta) =>
        this.db
          .prepare(
            `INSERT INTO gamer_points
               (gamer_id, room_id, games_played, wins, draws, losses, goals_for, goals_against, last_event_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(gamer_id) DO UPDATE SET
               room_id = excluded.room_id,
               games_played = gamer_points.games_played + excluded.games_played,
               wins = gamer_points.wins + excluded.wins,
               draws = gamer_points.draws + excluded.draws,
               losses = gamer_points.losses + excluded.losses,
               goals_for = gamer_points.goals_for + excluded.goals_for,
               goals_against = gamer_points.goals_against + excluded.goals_against,
               last_event_id = excluded.last_event_id,
               updated_at = excluded.updated_at`,
          )
          .bind(
            delta.gamerId,
            delta.roomId,
            delta.gamesPlayed,
            delta.wins,
            delta.draws,
            delta.losses,
            delta.goalsFor,
            delta.goalsAgainst,
            delta.lastEventId,
            delta.updatedAt,
          ),
      ),
      ...buildGamerTeamPointDeltas(event).map((delta) =>
        this.db
          .prepare(
            `INSERT INTO gamer_team_points
               (gamer_team_key, room_id, members_json, games_played, wins, draws, losses, goals_for, goals_against, last_event_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(gamer_team_key) DO UPDATE SET
               room_id = excluded.room_id,
               members_json = excluded.members_json,
               games_played = gamer_team_points.games_played + excluded.games_played,
               wins = gamer_team_points.wins + excluded.wins,
               draws = gamer_team_points.draws + excluded.draws,
               losses = gamer_team_points.losses + excluded.losses,
               goals_for = gamer_team_points.goals_for + excluded.goals_for,
               goals_against = gamer_team_points.goals_against + excluded.goals_against,
               last_event_id = excluded.last_event_id,
               updated_at = excluded.updated_at`,
          )
          .bind(
            delta.gamerTeamKey,
            delta.roomId,
            JSON.stringify(delta.members),
            delta.gamesPlayed,
            delta.wins,
            delta.draws,
            delta.losses,
            delta.goalsFor,
            delta.goalsAgainst,
            delta.lastEventId,
            delta.updatedAt,
          ),
      ),
    ]

    if (statements.length > 0) {
      await this.db.batch(statements)
    }
  }
}

function buildGamerPointDeltas(event: RecordedGameEnvelope): GamerPointDelta[] {
  const homeScore = event.payload.home.score ?? 0
  const awayScore = event.payload.away.score ?? 0

  return [
    ...event.payload.home.gamerIds.map((gamerId) =>
      buildGamerPointDelta(
        gamerId,
        event.payload.roomId,
        homeScore,
        awayScore,
        outcomeForSide(event.payload.result, 'home'),
        event.id,
        event.recordedAt,
      ),
    ),
    ...event.payload.away.gamerIds.map((gamerId) =>
      buildGamerPointDelta(
        gamerId,
        event.payload.roomId,
        awayScore,
        homeScore,
        outcomeForSide(event.payload.result, 'away'),
        event.id,
        event.recordedAt,
      ),
    ),
  ]
}

function buildGamerPointDelta(
  gamerId: string,
  roomId: string,
  goalsFor: number,
  goalsAgainst: number,
  outcome: 'win' | 'draw' | 'loss',
  lastEventId: string,
  updatedAt: number,
): GamerPointDelta {
  return {
    gamerId,
    roomId,
    gamesPlayed: 1,
    wins: outcome === 'win' ? 1 : 0,
    draws: outcome === 'draw' ? 1 : 0,
    losses: outcome === 'loss' ? 1 : 0,
    goalsFor,
    goalsAgainst,
    lastEventId,
    updatedAt,
  }
}

function buildGamerTeamPointDeltas(event: RecordedGameEnvelope): GamerTeamPointDelta[] {
  const homeScore = event.payload.home.score ?? 0
  const awayScore = event.payload.away.score ?? 0

  return [
    buildGamerTeamPointDelta(
      event.payload.home.gamerIds,
      event.payload.roomId,
      homeScore,
      awayScore,
      outcomeForSide(event.payload.result, 'home'),
      event.id,
      event.recordedAt,
    ),
    buildGamerTeamPointDelta(
      event.payload.away.gamerIds,
      event.payload.roomId,
      awayScore,
      homeScore,
      outcomeForSide(event.payload.result, 'away'),
      event.id,
      event.recordedAt,
    ),
  ]
}

function buildGamerTeamPointDelta(
  gamerIds: readonly string[],
  roomId: string,
  goalsFor: number,
  goalsAgainst: number,
  outcome: 'win' | 'draw' | 'loss',
  lastEventId: string,
  updatedAt: number,
): GamerTeamPointDelta {
  const members = [...gamerIds].sort()
  return {
    gamerTeamKey: gamerTeamKey(gamerIds as Parameters<typeof gamerTeamKey>[0]),
    roomId,
    members,
    gamesPlayed: 1,
    wins: outcome === 'win' ? 1 : 0,
    draws: outcome === 'draw' ? 1 : 0,
    losses: outcome === 'loss' ? 1 : 0,
    goalsFor,
    goalsAgainst,
    lastEventId,
    updatedAt,
  }
}

function outcomeForSide(
  result: GameRecordedEvent['result'],
  side: 'home' | 'away',
): 'win' | 'draw' | 'loss' {
  if (result === 'draw') return 'draw'
  return result === side ? 'win' : 'loss'
}
