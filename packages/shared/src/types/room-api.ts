import type {
  CurrentGame,
  GameFormat,
  GameNight,
  GameNightActiveGamer,
  Gamer,
  GamerPoints,
  GamerTeamPoints,
  RoomSummary,
  SquadPlatform,
} from './domain.js'
import type { BetEventPayload, GameResult, WagerSettlement } from './events.js'
import type {
  BetId,
  EventId,
  GameId,
  GameNightId,
  GamerId,
  GamerTeamKey,
  RoomId,
} from './ids.js'
import type {
  SquadAssetRefreshResult,
  SquadRepairResult,
  SquadResetResult,
  SquadSyncResult,
} from './squad.js'

export interface RoomSessionInfo {
  roomId: RoomId
  expiresAt: number
  token?: string
}

export const ROOM_SESSION_HEADER = 'x-fc26-room-session'

export interface RoomBootstrapResponse {
  room: RoomSummary
  gamers: ReadonlyArray<Gamer>
  activeGameNight: GameNight | null
  activeGameNightGamers: ReadonlyArray<GameNightActiveGamer>
  currentGame: CurrentGame | null
  bets: ReadonlyArray<Bet>
  session: RoomSessionInfo
}

export interface CreateRoomRequest {
  name: string
  pin?: string | null
  avatarUrl?: string | null
  defaultSelectionStrategy?: string
  squadPlatform?: SquadPlatform
}

export interface UpdateRoomSettingsRequest {
  squadPlatform?: SquadPlatform
}

export interface UpdateRoomSettingsResponse {
  room: RoomSummary
}

export interface JoinRoomRequest {
  identifier?: string
  pin?: string | null
}

export interface CreateGamerRequest {
  name: string
  rating?: number
  active?: boolean
  pin?: string | null
  avatarUrl?: string | null
}

export interface UpdateGamerRequest {
  name?: string
  rating?: number
  active?: boolean
  currentPin?: string | null
  pin?: string | null
  avatarUrl?: string | null
  /**
   * Skip the per-gamer PIN check on the server. Set by clients where the
   * hidden Settings panel is unlocked (room admins). The room session is
   * still required, so this is no broader than any other room mutation.
   */
  bypassPin?: boolean
}

export interface GamerResponse {
  gamer: Gamer
  /**
   * Latest game-night active-gamer pool when the mutation touched it
   * (e.g. a new active gamer added to the live game night, or a gamer
   * deactivated and removed from the pool). Omitted when the active
   * pool was not affected.
   */
  activeGameNightGamers?: ReadonlyArray<GameNightActiveGamer>
}

export interface CreateGameNightRequest {
  activeGamerIds?: ReadonlyArray<string>
}

export interface GameNightResponse {
  gameNight: GameNight
  activeGamers: ReadonlyArray<GameNightActiveGamer>
}

export interface UpdateGameNightActiveGamersRequest {
  activeGamerIds: ReadonlyArray<string>
}

export interface CreateCurrentGameManualRequest {
  allocationMode: 'manual'
  homeGamerIds: ReadonlyArray<string>
  awayGamerIds: ReadonlyArray<string>
  homeClubId?: number | null
  awayClubId?: number | null
}

export interface CreateCurrentGameRandomRequest {
  allocationMode: 'random'
  format: GameFormat
  selectionStrategyId?: string
  homeClubId?: number | null
  awayClubId?: number | null
}

export type CreateCurrentGameRequest =
  | CreateCurrentGameManualRequest
  | CreateCurrentGameRandomRequest

export interface CurrentGameResponse {
  currentGame: CurrentGame
  bets: ReadonlyArray<Bet>
}

export interface RecordCurrentGameResultRequest {
  result: GameResult
  homeScore?: number | null
  awayScore?: number | null
  occurredAt?: number
  entryMethod?: 'manual' | 'ocr'
  ocrModel?: string
  /** Club name recognised for the home side (e.g. from the TV photo). */
  homeClubName?: string | null
  /** Club name recognised for the away side (e.g. from the TV photo). */
  awayClubName?: string | null
  /**
   * Override the home clubId stored on the recorded event. Pass `null` to
   * clear (the OCR pass uses this when the recognised name doesn't match the
   * club picked before the game — the recognised label is then the only
   * truth). Omit to keep the active game's selection.
   */
  homeClubId?: number | null
  /** See {@link homeClubId}. */
  awayClubId?: number | null
}

export interface InterruptCurrentGameRequest {
  comment?: string | null
  occurredAt?: number
}

export interface ResolveCurrentGameResponse {
  currentGame: CurrentGame | null
  activeGameNight: GameNight
  eventId: string
  eventType: 'game_recorded' | 'game_interrupted'
}

export interface GamerScoreboardRow {
  gamer: Gamer
  stats: GamerPoints
  points: number
  winRate: number
  goalDiff: number
}

export interface GamerTeamScoreboardRow {
  gamerTeamKey: string
  members: ReadonlyArray<Gamer>
  stats: GamerTeamPoints
  points: number
  winRate: number
  goalDiff: number
}

export interface RoomScoreboardResponse {
  roomId: RoomId
  gamerRows: ReadonlyArray<GamerScoreboardRow>
  gamerRowsWithoutTeamGames: ReadonlyArray<GamerScoreboardRow>
  gamerTeamRows: ReadonlyArray<GamerTeamScoreboardRow>
  updatedAt: number | null
}

/** Which scoreboard entry a match-history drill-down is scoped to. */
export type MatchHistoryScope =
  | { type: 'gamer'; gamerId: GamerId }
  | { type: 'gamerTeam'; gamerTeamKey: GamerTeamKey }
  | { type: 'all' }

/** One side of a past match, resolved for display. */
export interface MatchHistorySide {
  gamerIds: ReadonlyArray<GamerId>
  /** Resolved gamer records for `gamerIds`, in the same order. */
  gamers: ReadonlyArray<Gamer>
  clubId: number
  /**
   * Display club name: the latest squad data's name for `clubId`, falling back
   * to the club name recognised at record time (used when no club was selected
   * before the game, so `clubId` is 0). Null when neither is available.
   */
  clubName: string | null
  /** Exact goals scored, or null when only the winner was recorded. */
  score: number | null
  /** True when this side won the match. */
  won: boolean
}

/** A single past game in a drill-down, most-recent-first. */
export interface MatchHistoryEntry {
  eventId: EventId
  gameId: GameId
  gameNightId: GameNightId
  occurredAt: number
  format: GameFormat
  result: GameResult
  home: MatchHistorySide
  away: MatchHistorySide
}

/**
 * Everything that happened to one game's betting book, grouped so the UI can
 * tell the story of a game rather than a flat stream of events.
 */
export interface BetHistoryGame {
  gameId: GameId
  gameNightId: GameNightId
  /** When the game resolved, or when the book was last touched if it has not. */
  occurredAt: number
  /**
   * Who played the game. Empty until the game is recorded — a live game has
   * players, but they are not in the event log yet.
   */
  playerIds: ReadonlyArray<GamerId>
  /** Placed / removed / locked / discarded, oldest first. */
  events: ReadonlyArray<BetEventPayload>
  /** Present once the game settled; absent for live, discarded or voided books. */
  settled?: ReadonlyArray<WagerSettlement>
}

export interface BetHistoryResponse {
  roomId: RoomId
  /** Newest game first. */
  games: ReadonlyArray<BetHistoryGame>
}

export interface MatchHistoryResponse {
  roomId: RoomId
  matches: ReadonlyArray<MatchHistoryEntry>
}

export interface RefreshRoomSquadAssetsResponse {
  result: SquadAssetRefreshResult
}

export interface RetrieveRoomSquadsResponse {
  result: SquadSyncResult
  /**
   * Outcome of the asset refresh that runs automatically after a successful
   * ingest. `null` means the refresh was attempted but threw — the user can
   * still retry it from Settings via the standalone refresh endpoint.
   */
  assetsResult: SquadAssetRefreshResult | null
}

export interface ResetRoomSquadsResponse {
  result: SquadResetResult
}

export interface RepairRoomSquadsResponse {
  result: SquadRepairResult
}

export interface AnalysePhotoRequest {
  image: string
  homeTeam?: { name: string; aliases: string[] } | null
  awayTeam?: { name: string; aliases: string[] } | null
}

export interface AnalysePhotoResponse {
  homeTeam: string | null
  awayTeam: string | null
  homeScore: number | null
  awayScore: number | null
  teamsMatched: boolean
  result: 'home' | 'away' | 'draw' | null
  error: string | null
  /** Which Gemini model produced this result. */
  model?: string
}

export interface Bet {
  id: BetId
  roomId: RoomId
  gameNightId: GameNightId
  gameId: GameId
  gamerId: GamerId
  outcome: GameResult
  stake: number
  createdAt: number
  updatedAt: number
}

export interface PlaceBetRequest {
  gamerId: string
  outcome: GameResult
  stake: number
}

export interface BetsResponse {
  bets: ReadonlyArray<Bet>
  /** Null while the book is open. Mirrors `CurrentGame.betsLockedAt`. */
  betsLockedAt: number | null
}

export interface ChipPosition {
  gamerId: GamerId
  /** Net chips tonight: winnings minus stakes. */
  net: number
}

export interface GameNightChipsResponse {
  gameNightId: GameNightId
  positions: ReadonlyArray<ChipPosition>
  /** Per-gamer deltas from the most recently settled game, for highlighting. */
  lastGameDeltas: ReadonlyArray<ChipPosition>
}
