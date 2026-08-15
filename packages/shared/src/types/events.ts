import type {
  BetId,
  EventId,
  GameNightId,
  GamerId,
  GamerTeamKey,
  GameId,
  RoomId,
} from './ids.js'
import type { GameFormat, GameSize } from './domain.js'

/**
 * Event log schema. Versioned because event payloads are stored on disk forever
 * and may be read by code newer than the writer. Always include `schemaVersion`
 * on writes; bump it when you change a payload shape.
 */
export const EVENT_SCHEMA_VERSION = 1 as const

export type EventType =
  | 'game_recorded'
  | 'game_interrupted'
  | 'game_voided'
  | 'bet_placed'
  | 'bet_removed'
  | 'bets_locked'
  | 'bets_discarded'
  | 'chips_purchased'

export type GameResult = 'home' | 'away' | 'draw'

export interface GameSide {
  /** Length 1 for size=2, length 2 for size=4. */
  gamerIds: readonly GamerId[]
  gamerTeamKey: GamerTeamKey
  clubId: number
  /**
   * Club name recognised at record time (e.g. read off the TV photo by the
   * OCR pass). Persisted so it survives squad-data changes and gives a label
   * for games started without a pre-selected club (clubId 0). Optional because
   * events recorded before this field existed won't have it.
   */
  clubName?: string | null
  /** Null when only the winner was recorded (no exact score entered). */
  score: number | null
}

/**
 * One gamer's settled position on a game. Written into the recorded event, so
 * this is the durable record — the live `bets` row is deleted at settlement.
 */
export interface WagerSettlement {
  gamerId: GamerId
  /** Which outcome this gamer backed. */
  outcome: GameResult
  stake: number
  /** 0 for a losing bet; equals `stake` when the pool was refunded. */
  payout: number
}

/**
 * Fields every bet event carries so the log can be read without joining back
 * to the live `bets` table — which is deliberately transient, since rows are
 * deleted at settlement.
 */
interface BetEventBase {
  schemaVersion: typeof EVENT_SCHEMA_VERSION
  roomId: RoomId
  gameNightId: GameNightId
  gameId: GameId
  /** When the action happened. */
  occurredAt: number
}

/** One bet as it stood at the moment an event was written. */
export interface BetSnapshot {
  betId: BetId
  /** The gamer who placed the wager, not the gamers playing the game. */
  gamerId: GamerId
  outcome: GameResult
  stake: number
}

export interface BetPlacedEvent extends BetEventBase, BetSnapshot {
  type: 'bet_placed'
  /**
   * Set when this bet replaced one the same gamer already had on the game.
   * The schema allows one bet per gamer per game, so a re-bet overwrites —
   * without this the previous stake and outcome would vanish from history.
   */
  replaced?: BetSnapshot
}

export interface BetRemovedEvent extends BetEventBase, BetSnapshot {
  type: 'bet_removed'
}

export interface BetsLockedEvent extends BetEventBase {
  type: 'bets_locked'
  /** The book as it stood when it closed — what everyone is playing for. */
  bets: readonly BetSnapshot[]
  pot: number
}

/**
 * Written when a game's book is thrown away without settling — an interrupted
 * game, or a night that ended with a game unresolved. Stakes are returned, so
 * this is a wash, but the attempt still belongs in the record.
 */
export interface BetsDiscardedEvent extends BetEventBase {
  type: 'bets_discarded'
  bets: readonly BetSnapshot[]
  reason: 'game_interrupted' | 'game_night_ended' | 'game_voided'
}

/**
 * Chips bought into the room.
 *
 * The only way tokens enter circulation. Wagering just moves them between
 * gamers, so `Σ purchases` is exactly how many chips exist, and a gamer's
 * profit is whatever they hold beyond what they paid for — which is what
 * makes the end-of-night settle-up sum to zero.
 *
 * Room-scoped rather than night-scoped: balances carry across nights, and a
 * purchase can happen whenever someone runs dry, not only at a night's start.
 */
export interface ChipsPurchasedEvent {
  type: 'chips_purchased'
  schemaVersion: typeof EVENT_SCHEMA_VERSION
  roomId: RoomId
  gamerId: GamerId
  /** Always positive. Chips are never un-bought; a mistake is corrected by play. */
  amount: number
  /** The night it happened on, or null for a purchase made outside one. */
  gameNightId: GameNightId | null
  occurredAt: number
  /** `game_night_buy_in` for the batch issued when a night starts. */
  reason: 'game_night_buy_in' | 'manual'
}

export interface GameRecordedEvent {
  type: 'game_recorded'
  schemaVersion: typeof EVENT_SCHEMA_VERSION
  gameId: GameId
  gameNightId: GameNightId
  roomId: RoomId
  format: GameFormat
  size: GameSize
  /** When the game was actually played. */
  occurredAt: number
  home: GameSide
  away: GameSide
  result: GameResult
  /** Squad version (R2 directory name) used at draw time. */
  squadVersion: string
  /** Which selection strategy picked the gamers (`'manual'` if hand-picked). */
  selectionStrategyId: string
  entryMethod: 'manual' | 'ocr'
  /** Set only when entryMethod === 'ocr'. */
  ocrModel?: string
  /**
   * Settled wagers for this game. Optional because events recorded before
   * wagering existed will not have it, and a game with no bets writes nothing.
   */
  wagers?: readonly WagerSettlement[]
}

export interface GameInterruptedEvent {
  type: 'game_interrupted'
  schemaVersion: typeof EVENT_SCHEMA_VERSION
  gameId: GameId
  gameNightId: GameNightId
  roomId: RoomId
  format: GameFormat
  size: GameSize
  occurredAt: number
  comment: string | null
}

export interface GameVoidedEvent {
  type: 'game_voided'
  schemaVersion: typeof EVENT_SCHEMA_VERSION
  /** Refers to a previous game_recorded by gameId. */
  gameId: GameId
  gameNightId: GameNightId
  roomId: RoomId
  occurredAt: number
  reason: string
}

export type GameEventPayload =
  | GameRecordedEvent
  | GameInterruptedEvent
  | GameVoidedEvent
  | BetPlacedEvent
  | BetRemovedEvent
  | BetsLockedEvent
  | BetsDiscardedEvent
  | ChipsPurchasedEvent

/** Narrowing helper — the bet events share a shape the game events do not. */
export type BetEventPayload =
  | BetPlacedEvent
  | BetRemovedEvent
  | BetsLockedEvent
  | BetsDiscardedEvent

export function isBetEvent(payload: GameEventPayload): payload is BetEventPayload {
  return (
    payload.type === 'bet_placed' ||
    payload.type === 'bet_removed' ||
    payload.type === 'bets_locked' ||
    payload.type === 'bets_discarded'
  )
}

/** Wire/storage envelope around a payload. Always written by the worker. */
export interface PersistedGameEvent {
  id: EventId
  roomId: RoomId
  eventType: EventType
  payload: GameEventPayload
  schemaVersion: number
  correlationId: string | null
  occurredAt: number
  recordedAt: number
}
