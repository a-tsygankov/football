import type { Gamer, GameSize } from '../types/domain.js'
import type { GamerId } from '../types/ids.js'
import { SelectionError, type IGamerSelectionStrategy } from './types.js'

/**
 * Wraps a strategy in a validator that enforces the contract every strategy
 * must obey:
 *  - Returns exactly `slots` gamers.
 *  - Returns only roster members (no fabrication).
 *  - Returns no duplicates.
 *  - Includes every locked gamer.
 *
 * Validation lives here once instead of being copy-pasted into every strategy.
 */
export function withValidator(strategy: IGamerSelectionStrategy): IGamerSelectionStrategy {
  return {
    id: strategy.id,
    displayName: strategy.displayName,
    description: strategy.description,
    select(roster, slots, locks, ctx) {
      assertCallerInputs(roster, slots, locks)
      const result = strategy.select(roster, slots, locks, ctx)
      assertResult(result, roster, slots, locks, strategy.id)
      return result
    },
  }
}

function assertCallerInputs(
  roster: ReadonlyArray<Gamer>,
  slots: GameSize,
  locks: ReadonlySet<GamerId>,
): void {
  if (slots !== 2 && slots !== 4) {
    throw new SelectionError(`slots must be 2 or 4, got ${slots as number}`)
  }
  if (roster.length < slots) {
    throw new SelectionError(`roster has ${roster.length} gamers, need at least ${slots}`)
  }
  if (locks.size > slots) {
    throw new SelectionError(`cannot have more locks (${locks.size}) than slots (${slots})`)
  }
  const rosterIds = new Set(roster.map((g) => g.id))
  for (const lockId of locks) {
    if (!rosterIds.has(lockId)) {
      throw new SelectionError(`locked gamer ${lockId} is not in the roster`)
    }
  }
}

function assertResult(
  result: ReadonlyArray<Gamer>,
  roster: ReadonlyArray<Gamer>,
  slots: GameSize,
  locks: ReadonlySet<GamerId>,
  strategyId: string,
): void {
  if (result.length !== slots) {
    throw new SelectionError(
      `strategy ${strategyId} returned ${result.length} gamers, expected ${slots}`,
    )
  }
  const seen = new Set<GamerId>()
  const rosterIds = new Set(roster.map((g) => g.id))
  for (const gamer of result) {
    if (!rosterIds.has(gamer.id)) {
      throw new SelectionError(`strategy ${strategyId} returned gamer ${gamer.id} not in roster`)
    }
    if (seen.has(gamer.id)) {
      throw new SelectionError(`strategy ${strategyId} returned duplicate gamer ${gamer.id}`)
    }
    seen.add(gamer.id)
  }
  for (const lockId of locks) {
    if (!seen.has(lockId)) {
      throw new SelectionError(`strategy ${strategyId} dropped locked gamer ${lockId}`)
    }
  }
}

/**
 * Helper used by strategies that need to take random non-locked gamers from a
 * pool. Centralised so the shuffle is deterministic and identical across
 * strategies.
 */
export function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
  return arr
}

/** Selects all gamers required by the locks, in roster order. */
export function lockedGamers(
  roster: ReadonlyArray<Gamer>,
  locks: ReadonlySet<GamerId>,
): Gamer[] {
  return roster.filter((g) => locks.has(g.id))
}

/** Returns the roster minus the locked gamers, preserving roster order. */
export function unlockedGamers(
  roster: ReadonlyArray<Gamer>,
  locks: ReadonlySet<GamerId>,
): Gamer[] {
  return roster.filter((g) => !locks.has(g.id))
}
