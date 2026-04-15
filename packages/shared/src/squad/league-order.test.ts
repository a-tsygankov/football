import { describe, expect, it } from 'vitest'
import { compareLeagueNames, getLeagueSortPriority } from './league-order.js'

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

  it('matches each priority European top tier across known sponsor variants', () => {
    const ordered = [
      'International',
      'Premier League',
      'LaLiga EA Sports',
      'Serie A Enilive',
      'Ligue 1 McDonalds',
      'Bundesliga',
      'Liga Portugal Betclic',
      'Jupiler Pro League',
      'Trendyol Süper Lig',
    ]
    const priorities = ordered.map((name) => getLeagueSortPriority(name))
    // Strictly increasing — proves the desired ordering is preserved.
    for (let i = 1; i < priorities.length; i += 1) {
      expect(priorities[i]).toBeGreaterThan(priorities[i - 1]!)
    }
  })

  it('places non-priority leagues after every priority league', () => {
    const priorityValues = [
      'Premier League',
      'LaLiga EA Sports',
      'Serie A Enilive',
      'Ligue 1 McDonalds',
      'Bundesliga',
      'Liga Portugal Betclic',
      'Jupiler Pro League',
      'Trendyol Süper Lig',
    ].map((name) => getLeagueSortPriority(name))
    const fallback = getLeagueSortPriority('Major League Soccer')
    for (const value of priorityValues) {
      expect(fallback).toBeGreaterThan(value)
    }
    expect(getLeagueSortPriority('Eredivisie')).toBe(fallback)
  })

  it('does not match 2. Bundesliga as the top-tier Bundesliga slot', () => {
    expect(getLeagueSortPriority('2. Bundesliga')).toBeGreaterThan(
      getLeagueSortPriority('Bundesliga'),
    )
  })

  it('compareLeagueNames sorts by priority then name', () => {
    const names = [
      'Major League Soccer',
      'Premier League',
      'Bundesliga',
      'International',
      'LaLiga EA Sports',
    ]
    const sorted = [...names].sort(compareLeagueNames)
    expect(sorted).toEqual([
      'International',
      'Premier League',
      'LaLiga EA Sports',
      'Bundesliga',
      'Major League Soccer',
    ])
  })
})
