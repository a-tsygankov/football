import { describe, expect, it } from 'vitest'
import type { Club } from '../types/squad.js'
import { canonicaliseLeagueIds } from './canonicalise-leagues.js'

function makeClub(overrides: Partial<Club> & { id: number }): Club {
  return {
    id: overrides.id,
    name: overrides.name ?? `Club${overrides.id}`,
    shortName: overrides.shortName ?? 'CLB',
    leagueId: overrides.leagueId ?? 0,
    leagueName: overrides.leagueName ?? 'Unknown',
    leagueLogoUrl: overrides.leagueLogoUrl ?? null,
    nationId: overrides.nationId ?? 0,
    overallRating: overrides.overallRating ?? 70,
    attackRating: overrides.attackRating ?? 70,
    midfieldRating: overrides.midfieldRating ?? 70,
    defenseRating: overrides.defenseRating ?? 70,
    avatarUrl: overrides.avatarUrl ?? null,
    logoUrl: overrides.logoUrl ?? 'pending:club:' + overrides.id,
    starRating: overrides.starRating ?? 5,
  }
}

describe('canonicaliseLeagueIds', () => {
  it('collapses multiple leagueIds sharing a name onto the largest-club-count id', () => {
    // Three raw leagueIds all spelled "Premier League": id 13 has 3 clubs,
    // id 40 has 2, id 41 has 1. Canonical must be 13 (the largest bucket);
    // clubs in the other buckets are rewritten to 13 and keep their league
    // name.
    const clubs: Club[] = [
      makeClub({ id: 1, leagueId: 13, leagueName: 'Premier League' }),
      makeClub({ id: 2, leagueId: 13, leagueName: 'Premier League' }),
      makeClub({ id: 3, leagueId: 13, leagueName: 'Premier League' }),
      makeClub({ id: 4, leagueId: 40, leagueName: 'Premier League' }),
      makeClub({ id: 5, leagueId: 40, leagueName: 'Premier League' }),
      makeClub({ id: 6, leagueId: 41, leagueName: 'Premier League' }),
    ]
    const result = canonicaliseLeagueIds(clubs)
    expect(result.every((c) => c.leagueId === 13)).toBe(true)
    expect(new Set(result.map((c) => c.leagueName))).toEqual(new Set(['Premier League']))
  })

  it('is case + whitespace insensitive when matching name buckets', () => {
    // EA occasionally ships inconsistent capitalisation and stray spaces.
    // Those variants must collapse into a single bucket; we keep the name
    // spelling of the canonical (largest) leagueId.
    const clubs: Club[] = [
      makeClub({ id: 1, leagueId: 7, leagueName: 'La Liga' }),
      makeClub({ id: 2, leagueId: 7, leagueName: 'La Liga' }),
      makeClub({ id: 3, leagueId: 8, leagueName: ' la liga ' }),
      makeClub({ id: 4, leagueId: 9, leagueName: 'LA  LIGA' }),
    ]
    const result = canonicaliseLeagueIds(clubs)
    expect(new Set(result.map((c) => c.leagueId))).toEqual(new Set([7]))
    // Canonical spelling is the one that belonged to leagueId 7 (largest count).
    expect(result.find((c) => c.id === 3)?.leagueName).toBe('La Liga')
  })

  it('breaks ties on the lowest numeric leagueId for determinism', () => {
    // Two ids with the same club count — the output must be stable across
    // runs. We pick the lowest id.
    const clubs: Club[] = [
      makeClub({ id: 1, leagueId: 50, leagueName: 'Serie A' }),
      makeClub({ id: 2, leagueId: 50, leagueName: 'Serie A' }),
      makeClub({ id: 3, leagueId: 31, leagueName: 'Serie A' }),
      makeClub({ id: 4, leagueId: 31, leagueName: 'Serie A' }),
    ]
    const result = canonicaliseLeagueIds(clubs)
    expect(result.every((c) => c.leagueId === 31)).toBe(true)
  })

  it('leaves clubs untouched when their league already has a single id', () => {
    // Pass-through test: all Bundesliga clubs under one id, LaLiga under
    // another — nothing changes.
    const clubs: Club[] = [
      makeClub({ id: 1, leagueId: 19, leagueName: 'Bundesliga' }),
      makeClub({ id: 2, leagueId: 19, leagueName: 'Bundesliga' }),
      makeClub({ id: 3, leagueId: 53, leagueName: 'LaLiga' }),
    ]
    const result = canonicaliseLeagueIds(clubs)
    expect(result).toEqual(clubs)
  })

  it('passes through clubs with blank league names without merging them', () => {
    // A club whose leagueName is empty / 'Unknown' / whitespace must never
    // be swept into another bucket. We treat missing-name as its own
    // un-canonicalisable slot to avoid creating phantom merges.
    const clubs: Club[] = [
      makeClub({ id: 1, leagueId: 0, leagueName: '' }),
      makeClub({ id: 2, leagueId: 0, leagueName: '   ' }),
      makeClub({ id: 3, leagueId: 13, leagueName: 'Premier League' }),
    ]
    const result = canonicaliseLeagueIds(clubs)
    expect(result[0]?.leagueId).toBe(0)
    expect(result[1]?.leagueId).toBe(0)
    expect(result[2]?.leagueId).toBe(13)
  })

  it('does not merge leagues whose names only partially overlap', () => {
    // Conservative: "Premier League" and "English Premier League" stay
    // separate. If EA is already using two names for one competition, the
    // current fix is to add a more aggressive normaliser with evidence —
    // not to guess.
    const clubs: Club[] = [
      makeClub({ id: 1, leagueId: 13, leagueName: 'Premier League' }),
      makeClub({ id: 2, leagueId: 14, leagueName: 'English Premier League' }),
    ]
    const result = canonicaliseLeagueIds(clubs)
    expect(new Set(result.map((c) => c.leagueId))).toEqual(new Set([13, 14]))
  })

  it('returns an empty array for empty input', () => {
    expect(canonicaliseLeagueIds([])).toEqual([])
  })
})
