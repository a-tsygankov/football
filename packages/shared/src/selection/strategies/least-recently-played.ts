import type { Gamer } from '../../types/domain.js'
import type { GamerId } from '../../types/ids.js'
import type { IGamerSelectionStrategy, SelectionContext } from '../types.js'
import { lockedGamers, shuffleInPlace, unlockedGamers } from '../validate.js'

/**
 * Picks the gamers who have waited longest since their last game. Locked
 * gamers are always included; remaining slots go to the longest-waiting
 * unlocked gamers. Ties are broken by a deterministic shuffle so that running
 * the strategy twice on identical data with the same seed yields the same
 * result.
 */
export const leastRecentlyPlayed: IGamerSelectionStrategy = {
  id: 'least-recently-played',
  displayName: 'Least Recently Played',
  description:
    'Prioritises gamers who have waited longest since their last game. Good for fairness across sessions.',

  select(roster, slots, locks, ctx) {
    const locked = lockedGamers(roster, locks)
    const remaining = slots - locked.length
    if (remaining === 0) return locked

    const pool = unlockedGamers(roster, locks)
    const lastPlayed = computeLastPlayedMap(pool, ctx)

    // Shuffle first so ties are broken deterministically but unpredictably
    // across seeds, then sort stable.
    shuffleInPlace(pool, ctx.rng)
    pool.sort((a, b) => (lastPlayed.get(a.id) ?? 0) - (lastPlayed.get(b.id) ?? 0))

    return [...locked, ...pool.slice(0, remaining)]
  },
}

function computeLastPlayedMap(
  pool: ReadonlyArray<Gamer>,
  ctx: SelectionContext,
): Map<GamerId, number> {
  const lastPlayed = new Map<GamerId, number>()
  for (const g of pool) lastPlayed.set(g.id, 0) // never played => Epoch

  for (const event of ctx.recentEvents) {
    if (event.payload.type !== 'game_recorded') continue
    const allGamers = [...event.payload.home.gamerIds, ...event.payload.away.gamerIds]
    for (const gid of allGamers) {
      const current = lastPlayed.get(gid)
      if (current !== undefined && event.occurredAt > current) {
        lastPlayed.set(gid, event.occurredAt)
      }
    }
  }
  return lastPlayed
}
