import { describe, expect, it } from 'vitest'
import {
  compareLeagueNames,
  getLeagueSortPriority,
  isNonCompetitiveLeagueName,
} from './league-order.js'

describe('league-order', () => {
  it("ranks men's international competitions above every domestic league", () => {
    expect(getLeagueSortPriority('International')).toBe(0)
    expect(getLeagueSortPriority('National Teams')).toBe(0)
    expect(getLeagueSortPriority("Men's National Teams")).toBe(0)
    expect(getLeagueSortPriority('Premier League')).toBeGreaterThan(0)
  })

  it("does not bump women's international competitions to the top", () => {
    expect(getLeagueSortPriority("Women's International")).toBeGreaterThan(1)
    expect(getLeagueSortPriority('NWSL')).toBeGreaterThan(1)
  })

  it('matches each priority tier across known sponsor / alias variants', () => {
    // Priorities must be strictly increasing in the order the product
    // owner prescribed: International, then England, Italy, Spain,
    // Rest of World, France, Germany, Belgium, Portugal, Turkey, USA.
    const ordered = [
      'International',
      'Premier League',
      'Serie A Enilive',
      'LaLiga EA Sports',
      'Rest of World',
      'Ligue 1 McDonalds',
      'Bundesliga',
      'Jupiler Pro League',
      'Liga Portugal Betclic',
      'Trendyol Süper Lig',
      'Major League Soccer',
    ]
    const priorities = ordered.map((name) => getLeagueSortPriority(name))
    for (let i = 1; i < priorities.length; i += 1) {
      expect(priorities[i]).toBeGreaterThan(priorities[i - 1]!)
    }
  })

  it('ranks Belgium above Portugal and USA above Turkey per the priority order', () => {
    expect(getLeagueSortPriority('Jupiler Pro League')).toBeLessThan(
      getLeagueSortPriority('Primeira Liga'),
    )
    expect(getLeagueSortPriority('Trendyol Süper Lig')).toBeLessThan(
      getLeagueSortPriority('Major League Soccer'),
    )
  })

  it('places non-priority leagues after every priority league', () => {
    const priorityValues = [
      'Premier League',
      'Serie A Enilive',
      'LaLiga EA Sports',
      'Rest of World',
      'Ligue 1 McDonalds',
      'Bundesliga',
      'Jupiler Pro League',
      'Liga Portugal Betclic',
      'Trendyol Süper Lig',
      'Major League Soccer',
    ].map((name) => getLeagueSortPriority(name))
    const fallback = getLeagueSortPriority('Eredivisie')
    for (const value of priorityValues) {
      expect(fallback).toBeGreaterThan(value)
    }
    expect(getLeagueSortPriority('Scottish Premiership')).toBe(fallback)
  })

  it('does not match 2. Bundesliga as the top-tier Bundesliga slot', () => {
    expect(getLeagueSortPriority('2. Bundesliga')).toBeGreaterThan(
      getLeagueSortPriority('Bundesliga'),
    )
  })

  describe('isNonCompetitiveLeagueName', () => {
    it('flags EA specialty buckets (classic / legends / icons / heroes / TOTS)', () => {
      // These are the buckets EA ships for historic XIs, FUT card
      // events and legendary players — NOT real domestic leagues.
      // Ingest uses this to keep them from stealing a team's home
      // league via `leagueTeamLinks` overrides.
      expect(isNonCompetitiveLeagueName('FUT Classic XI')).toBe(true)
      expect(isNonCompetitiveLeagueName('Premier League Classics')).toBe(true)
      expect(isNonCompetitiveLeagueName('Legends')).toBe(true)
      expect(isNonCompetitiveLeagueName('FUT Icons')).toBe(true)
      expect(isNonCompetitiveLeagueName('Icons')).toBe(true)
      expect(isNonCompetitiveLeagueName('Heroes')).toBe(true)
      expect(isNonCompetitiveLeagueName('Historic Teams')).toBe(true)
      expect(isNonCompetitiveLeagueName('All-Stars')).toBe(true)
      expect(isNonCompetitiveLeagueName('TOTS 2026')).toBe(true)
      expect(isNonCompetitiveLeagueName('Team of the Year')).toBe(true)
      expect(isNonCompetitiveLeagueName('FUT Ultimate Team Heroes')).toBe(true)
    })

    it('does not flag real domestic leagues', () => {
      // Regression guard: the regex must not match Premier League /
      // La Liga / Serie A on substring accidents. Note "Rest of
      // World" must NOT match any specialty pattern either.
      expect(isNonCompetitiveLeagueName('Premier League')).toBe(false)
      expect(isNonCompetitiveLeagueName('Serie A Enilive')).toBe(false)
      expect(isNonCompetitiveLeagueName('LaLiga EA Sports')).toBe(false)
      expect(isNonCompetitiveLeagueName('Bundesliga')).toBe(false)
      expect(isNonCompetitiveLeagueName('Ligue 1 McDonalds')).toBe(false)
      expect(isNonCompetitiveLeagueName('Rest of World')).toBe(false)
      expect(isNonCompetitiveLeagueName('Major League Soccer')).toBe(false)
    })

    it('returns false for blank / nullish input', () => {
      expect(isNonCompetitiveLeagueName('')).toBe(false)
      expect(isNonCompetitiveLeagueName(null)).toBe(false)
      expect(isNonCompetitiveLeagueName(undefined)).toBe(false)
    })
  })

  it('compareLeagueNames sorts by priority then name', () => {
    const names = [
      'Major League Soccer',
      'Premier League',
      'Bundesliga',
      'International',
      'LaLiga EA Sports',
      'Serie A Enilive',
      'Rest of World',
    ]
    const sorted = [...names].sort(compareLeagueNames)
    expect(sorted).toEqual([
      'International',
      'Premier League',
      'Serie A Enilive',
      'LaLiga EA Sports',
      'Rest of World',
      'Bundesliga',
      'Major League Soccer',
    ])
  })
})
