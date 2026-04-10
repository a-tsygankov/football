import type { Gamer } from '../../types/domain.js'
import type { IGamerSelectionStrategy } from '../types.js'
import { lockedGamers, shuffleInPlace, unlockedGamers } from '../validate.js'

/**
 * Picks a set whose rating spread is minimal, so the eventual sides can be
 * balanced as evenly as possible. Cheap because game size is at most 4 — we
 * just enumerate every valid combination.
 *
 * Locked gamers are always included; we pick the (slots - locks.size) others
 * such that the resulting set has the smallest variance.
 */
export const balancedRating: IGamerSelectionStrategy = {
  id: 'balanced-rating',
  displayName: 'Balanced Rating',
  description:
    'Picks gamers whose ratings are closest together so teams will be evenly matched.',

  select(roster, slots, locks, ctx) {
    const locked = lockedGamers(roster, locks)
    const remaining = slots - locked.length
    if (remaining === 0) return locked

    const pool = unlockedGamers(roster, locks)
    // Pre-shuffle so equal-variance combinations are tied at random across runs.
    shuffleInPlace(pool, ctx.rng)

    const lockedRatings = locked.map((g) => g.rating)

    let bestPick: Gamer[] | null = null
    let bestVariance = Number.POSITIVE_INFINITY

    for (const combo of combinations(pool, remaining)) {
      const ratings = [...lockedRatings, ...combo.map((g) => g.rating)]
      const variance = computeVariance(ratings)
      if (variance < bestVariance) {
        bestVariance = variance
        bestPick = combo
      }
    }

    if (bestPick === null) {
      // Should never happen — validator already checked roster.length >= slots.
      throw new Error('balanced-rating: no valid combination found')
    }

    return [...locked, ...bestPick]
  },
}

function* combinations<T>(arr: ReadonlyArray<T>, k: number): Generator<T[]> {
  if (k === 0) {
    yield []
    return
  }
  if (k > arr.length) return
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combinations(arr.slice(i + 1), k - 1)) {
      yield [arr[i]!, ...rest]
    }
  }
}

function computeVariance(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
}

// Re-export for tests that want to verify constants without re-deriving
export const _internal = { combinations, computeVariance }
