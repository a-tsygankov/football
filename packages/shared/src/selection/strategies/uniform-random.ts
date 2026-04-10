import type { IGamerSelectionStrategy } from '../types.js'
import { lockedGamers, shuffleInPlace, unlockedGamers } from '../validate.js'

/**
 * Baseline strategy: uniform random fill of unlocked slots.
 *
 * Behavior:
 *  - Locked gamers are always included.
 *  - Remaining slots filled by uniform random sampling from the unlocked pool.
 */
export const uniformRandom: IGamerSelectionStrategy = {
  id: 'uniform-random',
  displayName: 'Uniform Random',
  description: 'Picks unlocked gamers uniformly at random. The simplest fair option.',

  select(roster, slots, locks, ctx) {
    const locked = lockedGamers(roster, locks)
    const remaining = slots - locked.length
    if (remaining === 0) return locked

    const pool = unlockedGamers(roster, locks)
    shuffleInPlace(pool, ctx.rng)
    return [...locked, ...pool.slice(0, remaining)]
  },
}
