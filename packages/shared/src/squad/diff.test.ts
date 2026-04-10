import { describe, expect, it } from 'vitest'
import type { Club, FcPlayer } from '../types/squad.js'
import { diffSquads } from './diff.js'

const FIXED_NOW = 1_700_000_000_000

function club(overrides: Partial<Club> & Pick<Club, 'id'>): Club {
  return {
    id: overrides.id,
    name: `Club ${overrides.id}`,
    shortName: `C${overrides.id}`,
    leagueId: 1,
    leagueName: 'Premier League',
    nationId: 1,
    overallRating: 80,
    attackRating: 80,
    midfieldRating: 80,
    defenseRating: 80,
    logoUrl: `https://r2.example/logos/${overrides.id}.png`,
    starRating: 4,
    ...overrides,
  }
}

function player(overrides: Partial<FcPlayer> & Pick<FcPlayer, 'id' | 'clubId'>): FcPlayer {
  return {
    id: overrides.id,
    clubId: overrides.clubId,
    name: `Player ${overrides.id}`,
    position: 'ST',
    nationId: 1,
    overall: 80,
    attributes: {
      pace: 80,
      shooting: 80,
      passing: 80,
      dribbling: 80,
      defending: 50,
      physical: 70,
    },
    ...overrides,
  }
}

describe('diffSquads', () => {
  it('returns empty arrays when both snapshots are identical', () => {
    const clubs = [club({ id: 1 }), club({ id: 2 })]
    const players = [player({ id: 10, clubId: 1 }), player({ id: 11, clubId: 2 })]

    const diff = diffSquads({
      fromVersion: 'v1',
      toVersion: 'v2',
      fromClubs: clubs,
      toClubs: clubs,
      fromPlayers: players,
      toPlayers: players,
      generatedAt: FIXED_NOW,
    })

    expect(diff.playerChanges).toEqual([])
    expect(diff.clubChanges).toEqual([])
    expect(diff.addedPlayers).toEqual([])
    expect(diff.removedPlayers).toEqual([])
    expect(diff.fromVersion).toBe('v1')
    expect(diff.toVersion).toBe('v2')
    expect(diff.generatedAt).toBe(FIXED_NOW)
  })

  it('detects player overall and attribute changes', () => {
    const before = [
      player({ id: 10, clubId: 1, overall: 80 }),
    ]
    const after = [
      player({
        id: 10,
        clubId: 1,
        overall: 82,
        attributes: {
          pace: 85, // +5
          shooting: 80,
          passing: 80,
          dribbling: 80,
          defending: 50,
          physical: 70,
        },
      }),
    ]

    const diff = diffSquads({
      fromVersion: 'v1',
      toVersion: 'v2',
      fromClubs: [],
      toClubs: [],
      fromPlayers: before,
      toPlayers: after,
      generatedAt: FIXED_NOW,
    })

    expect(diff.playerChanges).toHaveLength(1)
    const entry = diff.playerChanges[0]!
    expect(entry.playerId).toBe(10)
    expect(entry.changes).toEqual([
      { field: 'overall', from: 80, to: 82 },
      { field: 'pace', from: 80, to: 85 },
    ])
  })

  it('detects added and removed players sorted by id', () => {
    const before = [player({ id: 10, clubId: 1 }), player({ id: 12, clubId: 1 })]
    const after = [player({ id: 11, clubId: 1 }), player({ id: 12, clubId: 1 })]

    const diff = diffSquads({
      fromVersion: 'v1',
      toVersion: 'v2',
      fromClubs: [],
      toClubs: [],
      fromPlayers: before,
      toPlayers: after,
      generatedAt: FIXED_NOW,
    })

    expect(diff.addedPlayers).toEqual([{ clubId: 1, playerId: 11, name: 'Player 11' }])
    expect(diff.removedPlayers).toEqual([{ clubId: 1, playerId: 10, name: 'Player 10' }])
    // Player 12 is unchanged so no entry in playerChanges either.
    expect(diff.playerChanges).toEqual([])
  })

  it('detects club rating changes in stable order', () => {
    const before = [club({ id: 1, overallRating: 80, starRating: 4 })]
    const after = [club({ id: 1, overallRating: 85, starRating: 4 })]

    const diff = diffSquads({
      fromVersion: 'v1',
      toVersion: 'v2',
      fromClubs: before,
      toClubs: after,
      fromPlayers: [],
      toPlayers: [],
      generatedAt: FIXED_NOW,
    })

    expect(diff.clubChanges).toEqual([
      { clubId: 1, field: 'overallRating', from: 80, to: 85 },
    ])
  })

  it('orders multi-field club changes by field display order', () => {
    const before = [
      club({
        id: 1,
        overallRating: 80,
        attackRating: 80,
        defenseRating: 80,
      }),
    ]
    const after = [
      club({
        id: 1,
        overallRating: 82,
        attackRating: 84,
        defenseRating: 78,
      }),
    ]

    const diff = diffSquads({
      fromVersion: 'v1',
      toVersion: 'v2',
      fromClubs: before,
      toClubs: after,
      fromPlayers: [],
      toPlayers: [],
      generatedAt: FIXED_NOW,
    })

    expect(diff.clubChanges.map((c) => c.field)).toEqual([
      'overallRating',
      'attackRating',
      'defenseRating',
    ])
  })

  it('throws on duplicate club ids in either snapshot', () => {
    expect(() =>
      diffSquads({
        fromVersion: 'v1',
        toVersion: 'v2',
        fromClubs: [club({ id: 1 }), club({ id: 1 })],
        toClubs: [],
        fromPlayers: [],
        toPlayers: [],
        generatedAt: FIXED_NOW,
      }),
    ).toThrow(/duplicate club id 1/)
  })

  it('throws on duplicate player ids in either snapshot', () => {
    expect(() =>
      diffSquads({
        fromVersion: 'v1',
        toVersion: 'v2',
        fromClubs: [],
        toClubs: [],
        fromPlayers: [],
        toPlayers: [player({ id: 10, clubId: 1 }), player({ id: 10, clubId: 2 })],
        generatedAt: FIXED_NOW,
      }),
    ).toThrow(/duplicate player id 10/)
  })

  it('produces deterministic output for the same input regardless of input order', () => {
    const clubsA = [club({ id: 2 }), club({ id: 1 })]
    const clubsB = [club({ id: 1, overallRating: 90 }), club({ id: 2 })]
    const playersA = [player({ id: 11, clubId: 2 }), player({ id: 10, clubId: 1 })]
    const playersB = [
      player({ id: 10, clubId: 1, overall: 85 }),
      player({ id: 11, clubId: 2 }),
    ]

    const diff1 = diffSquads({
      fromVersion: 'v1',
      toVersion: 'v2',
      fromClubs: clubsA,
      toClubs: clubsB,
      fromPlayers: playersA,
      toPlayers: playersB,
      generatedAt: FIXED_NOW,
    })
    const diff2 = diffSquads({
      fromVersion: 'v1',
      toVersion: 'v2',
      fromClubs: [...clubsA].reverse(),
      toClubs: [...clubsB].reverse(),
      fromPlayers: [...playersA].reverse(),
      toPlayers: [...playersB].reverse(),
      generatedAt: FIXED_NOW,
    })

    expect(JSON.stringify(diff1)).toEqual(JSON.stringify(diff2))
  })
})
