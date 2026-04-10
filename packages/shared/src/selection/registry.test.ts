import { describe, expect, it } from 'vitest'
import { DEFAULT_STRATEGY_ID, getStrategy, listStrategies } from './registry.js'

describe('selection registry', () => {
  it('lists all built-in strategies', () => {
    const ids = listStrategies().map((s) => s.id)
    expect(ids).toContain('uniform-random')
    expect(ids).toContain('least-recently-played')
    expect(ids).toContain('balanced-rating')
    expect(ids).toContain('fair-play-weighted')
  })

  it('getStrategy returns by id', () => {
    expect(getStrategy('uniform-random').id).toBe('uniform-random')
  })

  it('getStrategy throws on unknown id', () => {
    expect(() => getStrategy('no-such-strategy')).toThrow()
  })

  it('default strategy id is registered', () => {
    expect(getStrategy(DEFAULT_STRATEGY_ID).id).toBe(DEFAULT_STRATEGY_ID)
  })
})
