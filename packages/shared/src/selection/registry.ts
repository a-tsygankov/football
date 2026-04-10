import { SelectionError, type IGamerSelectionStrategy } from './types.js'
import { withValidator } from './validate.js'
import { uniformRandom } from './strategies/uniform-random.js'
import { leastRecentlyPlayed } from './strategies/least-recently-played.js'
import { balancedRating } from './strategies/balanced-rating.js'
import { fairPlayWeighted } from './strategies/fair-play-weighted.js'

/**
 * Strategy registry. Adding a new strategy is a one-line change here plus a
 * new file in ./strategies. Every strategy is automatically wrapped in the
 * validator so individual strategies don't have to defend their contracts.
 */
const strategies = new Map<string, IGamerSelectionStrategy>()

function register(strategy: IGamerSelectionStrategy): void {
  if (strategies.has(strategy.id)) {
    throw new Error(`Selection strategy already registered: ${strategy.id}`)
  }
  strategies.set(strategy.id, withValidator(strategy))
}

// Built-in strategies. Order is the display order in the room settings UI.
register(uniformRandom)
register(leastRecentlyPlayed)
register(balancedRating)
register(fairPlayWeighted)

export function getStrategy(id: string): IGamerSelectionStrategy {
  const s = strategies.get(id)
  if (!s) throw new SelectionError(`Unknown selection strategy: ${id}`)
  return s
}

export function listStrategies(): ReadonlyArray<IGamerSelectionStrategy> {
  return [...strategies.values()]
}

export const DEFAULT_STRATEGY_ID = 'uniform-random' as const
