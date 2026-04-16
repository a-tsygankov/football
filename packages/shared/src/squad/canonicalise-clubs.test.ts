import { describe, expect, it } from 'vitest'
import { canonicaliseClubs, remapPlayerClubIds } from './canonicalise-clubs.js'
import type { Club } from '../types/squad.js'

function makeClub(overrides: Partial<Club> & Pick<Club, 'id' | 'name' | 'leagueId'>): Club {
  return {
    id: overrides.id,
    name: overrides.name,
    shortName: overrides.shortName ?? overrides.name.slice(0, 3).toUpperCase(),
    leagueId: overrides.leagueId,
    leagueName: overrides.leagueName ?? 'Premier League',
    leagueLogoUrl: overrides.leagueLogoUrl ?? null,
    nationId: overrides.nationId ?? 0,
    overallRating: overrides.overallRating ?? 75,
    attackRating: overrides.attackRating ?? 75,
    midfieldRating: overrides.midfieldRating ?? 75,
    defenseRating: overrides.defenseRating ?? 75,
    avatarUrl: overrides.avatarUrl ?? null,
    logoUrl: overrides.logoUrl ?? 'https://example.com/logo.png',
    starRating: overrides.starRating ?? 6,
  }
}

describe('canonicaliseClubs', () => {
  it('returns input unchanged when no duplicates exist', () => {
    const clubs = [
      makeClub({ id: 1, name: 'Arsenal', leagueId: 13 }),
      makeClub({ id: 2, name: 'Chelsea', leagueId: 13 }),
    ]
    const result = canonicaliseClubs(clubs)
    expect(result.clubs).toEqual(clubs)
    expect(result.idRemap.size).toBe(0)
  })

  it('collapses two rows with same name and league, keeping the higher overall rating', () => {
    // After aliasing + league canonicalisation, a console "AC Milan" (id
    // 100, overall 85) and a handheld "AC Milan" (id 200, overall 84) can
    // end up in the same league bucket. The higher-rated row wins.
    const clubs = [
      makeClub({ id: 100, name: 'AC Milan', leagueId: 31, overallRating: 85 }),
      makeClub({ id: 200, name: 'AC Milan', leagueId: 31, overallRating: 84 }),
    ]
    const result = canonicaliseClubs(clubs)
    expect(result.clubs).toHaveLength(1)
    expect(result.clubs[0]!.id).toBe(100)
    expect(result.idRemap.get(200)).toBe(100)
  })

  it('breaks overall-rating ties on lowest id', () => {
    const clubs = [
      makeClub({ id: 500, name: 'Inter Milan', leagueId: 31, overallRating: 84 }),
      makeClub({ id: 50, name: 'Inter Milan', leagueId: 31, overallRating: 84 }),
      makeClub({ id: 200, name: 'Inter Milan', leagueId: 31, overallRating: 84 }),
    ]
    const result = canonicaliseClubs(clubs)
    expect(result.clubs).toHaveLength(1)
    expect(result.clubs[0]!.id).toBe(50)
    expect(result.idRemap.get(500)).toBe(50)
    expect(result.idRemap.get(200)).toBe(50)
  })

  it('treats different leagues as separate clubs even when names match', () => {
    // Real-world: Arsenal FC (England) and Arsenal de Sarandí (Argentina)
    // ship under different leagueIds — keep them both.
    const clubs = [
      makeClub({ id: 1, name: 'Arsenal', leagueId: 13 }),
      makeClub({ id: 2, name: 'Arsenal', leagueId: 353 }),
    ]
    const result = canonicaliseClubs(clubs)
    expect(result.clubs).toHaveLength(2)
    expect(result.idRemap.size).toBe(0)
  })

  it('normalises whitespace and case before matching', () => {
    const clubs = [
      makeClub({ id: 1, name: 'AC Milan', leagueId: 31, overallRating: 85 }),
      makeClub({ id: 2, name: '  ac  milan  ', leagueId: 31, overallRating: 80 }),
    ]
    const result = canonicaliseClubs(clubs)
    expect(result.clubs).toHaveLength(1)
    expect(result.clubs[0]!.id).toBe(1)
    expect(result.idRemap.get(2)).toBe(1)
  })

  it('preserves input order of surviving rows', () => {
    const clubs = [
      makeClub({ id: 1, name: 'Arsenal', leagueId: 13 }),
      makeClub({ id: 2, name: 'Chelsea', leagueId: 13 }),
      makeClub({ id: 3, name: 'Arsenal', leagueId: 13, overallRating: 70 }),
      makeClub({ id: 4, name: 'Liverpool', leagueId: 13 }),
    ]
    const result = canonicaliseClubs(clubs)
    expect(result.clubs.map((c) => c.id)).toEqual([1, 2, 4])
    expect(result.idRemap.get(3)).toBe(1)
  })

  it('handles empty input', () => {
    const result = canonicaliseClubs([])
    expect(result.clubs).toEqual([])
    expect(result.idRemap.size).toBe(0)
  })
})

describe('remapPlayerClubIds', () => {
  it('returns the original list when the remap is empty', () => {
    const players = [
      { id: 1, clubId: 100, name: 'Player One' },
      { id: 2, clubId: 200, name: 'Player Two' },
    ]
    const result = remapPlayerClubIds(players, new Map())
    expect(result.changed).toBe(false)
    expect(result.players).toEqual(players)
  })

  it('rewrites clubId fields that appear in the remap, leaves others alone', () => {
    const players = [
      { id: 1, clubId: 200, name: 'Rewritten' },
      { id: 2, clubId: 100, name: 'Untouched' },
    ]
    const remap = new Map<number, number>([[200, 100]])
    const result = remapPlayerClubIds(players, remap)
    expect(result.changed).toBe(true)
    expect(result.players[0]!.clubId).toBe(100)
    expect(result.players[1]!.clubId).toBe(100)
  })

  it('reports no changes when no player references a collapsed id', () => {
    const players = [{ id: 1, clubId: 100, name: 'Alone' }]
    const remap = new Map<number, number>([[999, 100]])
    const result = remapPlayerClubIds(players, remap)
    expect(result.changed).toBe(false)
  })
})
