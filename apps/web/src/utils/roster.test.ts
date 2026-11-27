import { describe, expect, it } from 'vitest'
import { assignmentsFromSides, lastGameSides } from './roster.js'

const match = (home: string[], away: string[]) => ({ home: { gamerIds: home }, away: { gamerIds: away } })

describe('lastGameSides', () => {
  it('offers the last game when everyone in it can still play', () => {
    const sides = lastGameSides(match(['ann', 'bob'], ['cy']), new Set(['ann', 'bob', 'cy', 'dee']))

    expect(sides).toEqual({ home: ['ann', 'bob'], away: ['cy'] })
  })

  it('offers nothing when one of them has left the pool', () => {
    // A line-up with a hole in it looks ready and is not.
    expect(lastGameSides(match(['ann'], ['bob']), new Set(['ann', 'cy']))).toBeNull()
  })

  it('offers nothing before the first game', () => {
    expect(lastGameSides(undefined, new Set(['ann', 'bob']))).toBeNull()
  })

  it('offers nothing for a game recorded without one of its sides', () => {
    expect(lastGameSides(match(['ann'], []), new Set(['ann', 'bob']))).toBeNull()
  })

  it('hands back copies, so the history it read stays as it was', () => {
    const last = match(['ann'], ['bob'])
    const sides = lastGameSides(last, new Set(['ann', 'bob']))!

    sides.home.push('cy')

    expect(last.home.gamerIds).toEqual(['ann'])
  })
})

describe('assignmentsFromSides', () => {
  it('puts each gamer on the side they played', () => {
    expect(assignmentsFromSides({ home: ['ann', 'bob'], away: ['cy'] })).toEqual({
      ann: 'home',
      bob: 'home',
      cy: 'away',
    })
  })
})
