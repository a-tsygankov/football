import { describe, expect, it } from 'vitest'
import { GamerId } from './ids.js'
import { gamerTeamKey } from './gamer-team.js'

describe('gamerTeamKey', () => {
  it('produces the same key regardless of input order', () => {
    const a = gamerTeamKey([GamerId('alice'), GamerId('bob')])
    const b = gamerTeamKey([GamerId('bob'), GamerId('alice')])
    expect(a).toBe(b)
  })

  it('handles a singleton team (size=2 game has one gamer per side)', () => {
    expect(gamerTeamKey([GamerId('alice')])).toBe('gt_alice')
  })

  it('handles a pair team (size=4 game has two gamers per side)', () => {
    expect(gamerTeamKey([GamerId('alice'), GamerId('bob')])).toBe('gt_alice_bob')
  })

  it('throws on empty input', () => {
    expect(() => gamerTeamKey([])).toThrow()
  })
})
