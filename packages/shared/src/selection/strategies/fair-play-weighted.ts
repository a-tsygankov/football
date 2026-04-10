import type { Gamer } from '../../types/domain.js'
import type { GamerId } from '../../types/ids.js'
import type { IGamerSelectionStrategy, SelectionContext } from '../types.js'
import { lockedGamers, unlockedGamers } from '../validate.js'

/**
 * Weighted random selection where weight = 1 / (1 + recentGamesCount).
 * Gamers who have played recently are less likely to be picked, but never
 * impossible. Gives everyone a chance without being rigid like
 * least-recently-played.
 *
 * "Recent" means events within the trailing window — currently the last 20
 * recorded games. Tune this constant if balance feels off; the test suite
 * pins behaviour for the current value.
 */
const RECENT_WINDOW = 20

export const fairPlayWeighted: IGamerSelectionStrategy = {
  id: 'fair-play-weighted',
  displayName: 'Fair Play (Weighted)',
  description:
    'Weighted random — gamers who have played less recently are more likely to be picked, but everyone has a chance.',

  select(roster, slots, locks, ctx) {
    const locked = lockedGamers(roster, locks)
    const remaining = slots - locked.length
    if (remaining === 0) return locked

    const pool = unlockedGamers(roster, locks)
    const recentCounts = countRecentAppearances(pool, ctx)
    const weights = pool.map((g) => 1 / (1 + (recentCounts.get(g.id) ?? 0)))

    const picked: Gamer[] = []
    const remainingPool = [...pool]
    const remainingWeights = [...weights]

    for (let i = 0; i < remaining; i++) {
      const idx = weightedPickIndex(remainingWeights, ctx.rng)
      picked.push(remainingPool[idx]!)
      remainingPool.splice(idx, 1)
      remainingWeights.splice(idx, 1)
    }

    return [...locked, ...picked]
  },
}

function countRecentAppearances(
  pool: ReadonlyArray<Gamer>,
  ctx: SelectionContext,
): Map<GamerId, number> {
  const counts = new Map<GamerId, number>()
  for (const g of pool) counts.set(g.id, 0)

  let seen = 0
  for (const event of ctx.recentEvents) {
    if (seen >= RECENT_WINDOW) break
    if (event.payload.type !== 'game_recorded') continue
    seen++
    const allGamers = [...event.payload.home.gamerIds, ...event.payload.away.gamerIds]
    for (const gid of allGamers) {
      const current = counts.get(gid)
      if (current !== undefined) counts.set(gid, current + 1)
    }
  }
  return counts
}

function weightedPickIndex(weights: ReadonlyArray<number>, rng: () => number): number {
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return 0
  let target = rng() * total
  for (let i = 0; i < weights.length; i++) {
    target -= weights[i]!
    if (target <= 0) return i
  }
  return weights.length - 1
}
