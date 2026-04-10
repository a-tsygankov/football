import type { Gamer, GameSize } from '../types/domain.js'
import type { GamerId } from '../types/ids.js'
import type { GamerPoints } from '../types/domain.js'
import type { PersistedGameEvent } from '../types/events.js'

/**
 * Context passed to every strategy. Strategies are PURE: they may not call
 * Math.random or Date.now directly. Everything they need comes through here,
 * which makes every strategy trivially unit-testable and replayable from the
 * event log.
 */
export interface SelectionContext {
  /** Current gamer_points projection for the room. */
  readonly stats: ReadonlyMap<GamerId, GamerPoints>
  /** Recent events, newest first. Strategies may inspect who just played. */
  readonly recentEvents: ReadonlyArray<PersistedGameEvent>
  /** Deterministic RNG seeded per call. Returns a float in [0, 1). */
  readonly rng: () => number
  /** UTC millis of "now" for any age-based weighting. */
  readonly now: number
}

export interface IGamerSelectionStrategy {
  readonly id: string
  readonly displayName: string
  readonly description: string

  /**
   * Returns exactly `slots` gamers from the roster, always including every
   * locked gamer. Pure with respect to `ctx.rng` and `ctx.now` — same inputs
   * produce the same output.
   */
  select(
    roster: ReadonlyArray<Gamer>,
    slots: GameSize,
    locks: ReadonlySet<GamerId>,
    ctx: SelectionContext,
  ): ReadonlyArray<Gamer>
}

export class SelectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SelectionError'
  }
}
