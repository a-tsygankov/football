import { describe, expect, it } from 'vitest'
import { DEFAULT_ROUTE, parseHash } from './useHashRoute.js'

describe('parseHash', () => {
  it('reads the route out of a hash', () => {
    expect(parseHash('#/wager')).toBe('wager')
    expect(parseHash('#/roster')).toBe('roster')
    expect(parseHash('#/teams')).toBe('teams')
  })

  it('tolerates a missing leading slash', () => {
    expect(parseHash('#wager')).toBe('wager')
  })

  it('ignores trailing segments and query strings', () => {
    // Deep links may grow suffixes later; the tab is the first segment.
    expect(parseHash('#/wager/history')).toBe('wager')
    expect(parseHash('#/wager?gamer=ann')).toBe('wager')
  })

  it('falls back to the default for empty or unknown hashes', () => {
    expect(parseHash('')).toBe(DEFAULT_ROUTE)
    expect(parseHash('#')).toBe(DEFAULT_ROUTE)
    expect(parseHash('#/')).toBe(DEFAULT_ROUTE)
    // An old bookmark to a route that no longer exists should land somewhere
    // usable rather than rendering a blank screen.
    expect(parseHash('#/nonsense')).toBe(DEFAULT_ROUTE)
  })
})
