import type { GameResult } from '../types/events.js'
import type { GamerId } from '../types/ids.js'

/** A bet as it exists while the book is open, before settlement. */
export interface WagerBet {
  gamerId: GamerId
  outcome: GameResult
  stake: number
}

/** The two sides of a game, as far as the wagering rules care. */
export interface WagerGameSides {
  homeGamerIds: readonly GamerId[]
  awayGamerIds: readonly GamerId[]
}
