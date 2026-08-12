import { describe, expect, it } from 'vitest'
import { GamerId } from '../types/ids.js'
import { canBack, describeIneligibility } from './eligibility.js'
import type { WagerGameSides } from './types.js'

const ann = GamerId('ann')
const bob = GamerId('bob')
const spectator = GamerId('cy')

const game: WagerGameSides = { homeGamerIds: [ann], awayGamerIds: [bob] }

describe('canBack', () => {
  it('lets a home player back only home', () => {
    expect(canBack(ann, game, 'home')).toBe(true)
    expect(canBack(ann, game, 'away')).toBe(false)
    expect(canBack(ann, game, 'draw')).toBe(false)
  })

  it('lets an away player back only away', () => {
    expect(canBack(bob, game, 'away')).toBe(true)
    expect(canBack(bob, game, 'home')).toBe(false)
    expect(canBack(bob, game, 'draw')).toBe(false)
  })

  it('lets a non-participant back any outcome', () => {
    expect(canBack(spectator, game, 'home')).toBe(true)
    expect(canBack(spectator, game, 'away')).toBe(true)
    expect(canBack(spectator, game, 'draw')).toBe(true)
  })

  it('applies the rule to both members of a 2v2 side', () => {
    const dee = GamerId('dee')
    const doubles: WagerGameSides = { homeGamerIds: [ann, dee], awayGamerIds: [bob] }
    expect(canBack(dee, doubles, 'home')).toBe(true)
    expect(canBack(dee, doubles, 'draw')).toBe(false)
  })
})

describe('describeIneligibility', () => {
  it('returns null when the bet is allowed', () => {
    expect(describeIneligibility(ann, game, 'home')).toBeNull()
    expect(describeIneligibility(spectator, game, 'draw')).toBeNull()
  })

  it('explains why a participant cannot back another outcome', () => {
    expect(describeIneligibility(ann, game, 'draw')).toBe("You're playing home — you can only back Home.")
    expect(describeIneligibility(bob, game, 'home')).toBe("You're playing away — you can only back Away.")
  })
})
