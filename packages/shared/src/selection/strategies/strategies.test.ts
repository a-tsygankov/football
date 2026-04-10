import { describe, expect, it } from 'vitest'
import { GamerId, RoomId } from '../../types/ids.js'
import type { Gamer, GameSize } from '../../types/domain.js'
import type { PersistedGameEvent } from '../../types/events.js'
import { mulberry32 } from '../rng.js'
import type { IGamerSelectionStrategy, SelectionContext } from '../types.js'
import { withValidator } from '../validate.js'
import { uniformRandom } from './uniform-random.js'
import { leastRecentlyPlayed } from './least-recently-played.js'
import { balancedRating } from './balanced-rating.js'
import { fairPlayWeighted } from './fair-play-weighted.js'

const ROOM = RoomId('room1')

function makeGamer(id: string, rating = 3): Gamer {
  return {
    id: GamerId(id),
    roomId: ROOM,
    name: id,
    rating,
    active: true,
    createdAt: 0,
    updatedAt: 0,
  }
}

function makeContext(
  overrides: Partial<SelectionContext> = {},
): SelectionContext {
  return {
    stats: new Map(),
    recentEvents: [],
    rng: mulberry32(42),
    now: 1_000_000,
    ...overrides,
  }
}

const STRATEGIES: ReadonlyArray<IGamerSelectionStrategy> = [
  withValidator(uniformRandom),
  withValidator(leastRecentlyPlayed),
  withValidator(balancedRating),
  withValidator(fairPlayWeighted),
]

const SIZES: ReadonlyArray<GameSize> = [2, 4]

describe.each(STRATEGIES.map((s) => [s.id, s] as const))('strategy %s', (_id, strategy) => {
  describe.each(SIZES)('with size=%i', (slots) => {
    const roster = [
      makeGamer('alice', 5),
      makeGamer('bob', 4),
      makeGamer('carl', 3),
      makeGamer('dora', 2),
      makeGamer('evan', 1),
    ]

    it('returns exactly `slots` gamers', () => {
      const result = strategy.select(roster, slots, new Set(), makeContext())
      expect(result).toHaveLength(slots)
    })

    it('returns only roster members', () => {
      const result = strategy.select(roster, slots, new Set(), makeContext())
      const rosterIds = new Set(roster.map((g) => g.id))
      for (const g of result) expect(rosterIds.has(g.id)).toBe(true)
    })

    it('returns no duplicates', () => {
      const result = strategy.select(roster, slots, new Set(), makeContext())
      expect(new Set(result.map((g) => g.id)).size).toBe(slots)
    })

    it('always includes locked gamers', () => {
      const locks = new Set([GamerId('alice'), GamerId('evan')]).size > slots
        ? new Set([GamerId('alice')])
        : new Set([GamerId('alice'), GamerId('evan')].slice(0, slots))
      const result = strategy.select(roster, slots, locks, makeContext())
      for (const lock of locks) {
        expect(result.some((g) => g.id === lock)).toBe(true)
      }
    })

    it('is deterministic for a given seed', () => {
      const a = strategy.select(roster, slots, new Set(), makeContext({ rng: mulberry32(7) }))
      const b = strategy.select(roster, slots, new Set(), makeContext({ rng: mulberry32(7) }))
      expect(a.map((g) => g.id)).toEqual(b.map((g) => g.id))
    })

    it('handles roster.length === slots (only one valid answer)', () => {
      const tight = roster.slice(0, slots)
      const result = strategy.select(tight, slots, new Set(), makeContext())
      expect(result.map((g) => g.id).sort()).toEqual(tight.map((g) => g.id).sort())
    })

    it('handles all-locked case', () => {
      const lockedSet = new Set(roster.slice(0, slots).map((g) => g.id))
      const result = strategy.select(roster, slots, lockedSet, makeContext())
      expect(new Set(result.map((g) => g.id))).toEqual(lockedSet)
    })
  })

  describe('contract violations', () => {
    const roster = [
      makeGamer('alice'),
      makeGamer('bob'),
      makeGamer('carl'),
      makeGamer('dora'),
    ]

    it('rejects roster smaller than slots', () => {
      expect(() =>
        strategy.select(roster.slice(0, 1), 2, new Set(), makeContext()),
      ).toThrow()
    })

    it('rejects locks larger than slots', () => {
      expect(() =>
        strategy.select(
          roster,
          2,
          new Set([GamerId('alice'), GamerId('bob'), GamerId('carl')]),
          makeContext(),
        ),
      ).toThrow()
    })

    it('rejects locks referencing gamers not in the roster', () => {
      expect(() =>
        strategy.select(roster, 2, new Set([GamerId('phantom')]), makeContext()),
      ).toThrow()
    })
  })
})

describe('balanced-rating specifics', () => {
  it('prefers gamers with closer ratings', () => {
    // Roster: 1, 2, 3, 5, 5 — best 2-pick should be the two 5s (variance 0)
    const roster = [
      makeGamer('a', 1),
      makeGamer('b', 2),
      makeGamer('c', 3),
      makeGamer('d', 5),
      makeGamer('e', 5),
    ]
    const result = withValidator(balancedRating).select(roster, 2, new Set(), makeContext())
    expect(result.map((g) => g.id).sort()).toEqual([GamerId('d'), GamerId('e')].sort())
  })
})

describe('least-recently-played specifics', () => {
  it('prefers the gamer who has not played recently', () => {
    const roster = [makeGamer('alice'), makeGamer('bob'), makeGamer('carl')]
    // Bob played most recently; Alice & Carl tied. Pick 2: should include the
    // two who waited longest = Alice and Carl.
    const events: PersistedGameEvent[] = [
      {
        id: 'e1' as never,
        roomId: ROOM,
        eventType: 'game_recorded',
        schemaVersion: 1,
        correlationId: null,
        occurredAt: 999_000,
        recordedAt: 999_000,
        payload: {
          type: 'game_recorded',
          schemaVersion: 1,
          gameId: 'g1' as never,
          roomId: ROOM,
          size: 2,
          occurredAt: 999_000,
          home: {
            gamerIds: [GamerId('bob')],
            gamerTeamKey: 'gt_bob' as never,
            clubId: 1,
            score: 1,
          },
          away: {
            gamerIds: [GamerId('zara')], // not in roster, irrelevant
            gamerTeamKey: 'gt_zara' as never,
            clubId: 2,
            score: 0,
          },
          result: 'home',
          squadVersion: 'fc26-r1',
          selectionStrategyId: 'uniform-random',
          entryMethod: 'manual',
        },
      },
    ]
    const result = withValidator(leastRecentlyPlayed).select(
      roster,
      2,
      new Set(),
      makeContext({ recentEvents: events }),
    )
    const ids = result.map((g) => g.id).sort()
    expect(ids).toEqual([GamerId('alice'), GamerId('carl')].sort())
  })
})
