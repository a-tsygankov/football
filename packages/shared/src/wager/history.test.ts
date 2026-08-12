import { describe, expect, it } from 'vitest'
import { filterBetHistory, netForGamer, participatedInBetGame } from './history.js'
import { BetId, GameId, GameNightId, GamerId } from '../types/ids.js'
import type { BetHistoryGame } from '../types/room-api.js'

const ann = GamerId('ann')
const bob = GamerId('bob')
const cy = GamerId('cy')

function snapshot(gamerId: ReturnType<typeof GamerId>, stake: number) {
  return { betId: BetId(`b-${gamerId}`), gamerId, outcome: 'home' as const, stake }
}

function game(overrides: Partial<BetHistoryGame> = {}): BetHistoryGame {
  return {
    gameId: GameId('g1'),
    gameNightId: GameNightId('n1'),
    occurredAt: 1_000,
    playerIds: [],
    events: [],
    ...overrides,
  } as BetHistoryGame
}

describe('participatedInBetGame', () => {
  it('matches someone who played the game', () => {
    expect(participatedInBetGame(game({ playerIds: [ann, bob] }), ann)).toBe(true)
  })

  it('matches someone who backed a game they did not play', () => {
    // Having money on a game is its own reason to see how it resolved.
    const g = game({
      playerIds: [ann, bob],
      events: [
        {
          type: 'bet_placed',
          schemaVersion: 1,
          roomId: 'r1',
          gameNightId: GameNightId('n1'),
          gameId: GameId('g1'),
          occurredAt: 1,
          ...snapshot(cy, 25),
        },
      ],
    } as Partial<BetHistoryGame>)
    expect(participatedInBetGame(g, cy)).toBe(true)
  })

  it('matches a bettor named only inside a locked book', () => {
    const g = game({
      events: [
        {
          type: 'bets_locked',
          schemaVersion: 1,
          roomId: 'r1',
          gameNightId: GameNightId('n1'),
          gameId: GameId('g1'),
          occurredAt: 2,
          bets: [snapshot(cy, 25)],
          pot: 25,
        },
      ],
    } as Partial<BetHistoryGame>)
    expect(participatedInBetGame(g, cy)).toBe(true)
  })

  it('matches a bettor whose stake was discarded', () => {
    // An interrupted game is a wash, but the person who staked still took part.
    const g = game({
      events: [
        {
          type: 'bets_discarded',
          schemaVersion: 1,
          roomId: 'r1',
          gameNightId: GameNightId('n1'),
          gameId: GameId('g1'),
          occurredAt: 3,
          bets: [snapshot(cy, 40)],
          reason: 'game_interrupted',
        },
      ],
    } as Partial<BetHistoryGame>)
    expect(participatedInBetGame(g, cy)).toBe(true)
  })

  it('does not match an uninvolved gamer', () => {
    expect(participatedInBetGame(game({ playerIds: [ann, bob] }), cy)).toBe(false)
  })
})

describe('filterBetHistory', () => {
  const played = game({ gameId: GameId('g1'), playerIds: [ann] })
  const other = game({ gameId: GameId('g2'), playerIds: [bob] })

  it('keeps only the games the gamer took part in', () => {
    expect(filterBetHistory([played, other], ann).map((g) => g.gameId)).toEqual(['g1'])
  })

  it('returns everything for the admin view', () => {
    // null means "no filter" — what the unlocked-settings view passes.
    expect(filterBetHistory([played, other], null)).toHaveLength(2)
  })

  it('returns nothing when the gamer took part in nothing', () => {
    expect(filterBetHistory([played, other], cy)).toHaveLength(0)
  })
})

describe('netForGamer', () => {
  it('nets payout against stake', () => {
    const g = game({
      settled: [
        { gamerId: ann, outcome: 'home', stake: 50, payout: 120 },
        { gamerId: bob, outcome: 'away', stake: 70, payout: 0 },
      ],
    })
    expect(netForGamer(g, ann)).toBe(70)
    expect(netForGamer(g, bob)).toBe(-70)
  })

  it('is null for an unsettled game or an uninvolved gamer', () => {
    expect(netForGamer(game(), ann)).toBeNull()
    expect(
      netForGamer(
        game({ settled: [{ gamerId: ann, outcome: 'home', stake: 10, payout: 10 }] }),
        cy,
      ),
    ).toBeNull()
  })
})
