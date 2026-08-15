import { describe, expect, it } from 'vitest'
import { BetId, GameId, GameNightId, GamerId, RoomId, type Bet } from '@fc26/shared'
import { InMemoryBetRepository } from './repository.js'

const roomId = RoomId('room-1')
const gameNightId = GameNightId('night-1')
const gameId = GameId('game-1')

function bet(id: string, gamerId: string, stake: number): Bet {
  return {
    id: BetId(id),
    roomId,
    gameNightId,
    gameId,
    gamerId: GamerId(gamerId),
    outcome: 'home',
    stake,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('InMemoryBetRepository', () => {
  it('lists bets for a game', async () => {
    const repo = new InMemoryBetRepository()
    await repo.upsert(bet('b1', 'ann', 10))
    await repo.upsert(bet('b2', 'bob', 20))

    expect((await repo.listByGame(gameId)).map((item) => item.stake)).toEqual([10, 20])
  })

  it('merges a repeat bet on the same outcome rather than adding one', async () => {
    const repo = new InMemoryBetRepository()
    await repo.upsert(bet('b1', 'ann', 10))
    await repo.upsert(bet('b2', 'ann', 75))

    // Uniqueness is (game, gamer, outcome), so this is the same position and
    // keeps the id it was created with.
    const bets = await repo.listByGame(gameId)
    expect(bets).toHaveLength(1)
    expect(bets[0]!.id).toBe(BetId('b1'))
    expect(bets[0]!.stake).toBe(75)
  })

  it('keeps a bet on another outcome as a separate position', async () => {
    const repo = new InMemoryBetRepository()
    await repo.upsert(bet('b1', 'ann', 10))
    await repo.upsert({ ...bet('b2', 'ann', 75), outcome: 'draw' })

    // Both sides stand — one gamer, two positions. That is a hedge.
    const bets = await repo.listByGame(gameId)
    expect(bets).toHaveLength(2)
    expect(bets.map((item) => item.outcome).sort()).toEqual(['draw', 'home'])
  })

  it('lists a night across its games, and only that night', async () => {
    const repo = new InMemoryBetRepository()
    await repo.upsert(bet('b1', 'ann', 10))
    await repo.upsert({ ...bet('b2', 'ann', 20), gameId: GameId('game-2') })
    await repo.upsert({
      ...bet('b3', 'ann', 40),
      gameNightId: GameNightId('night-2'),
      gameId: GameId('game-3'),
    })

    // What a gamer has at risk spans every open book of the night, but stops
    // at the night boundary — last week's stakes are not tonight's exposure.
    const stakes = (await repo.listByGameNight(gameNightId)).map((item) => item.stake)
    expect(stakes).toEqual([10, 20])
  })

  it('removes a single bet', async () => {
    const repo = new InMemoryBetRepository()
    await repo.upsert(bet('b1', 'ann', 10))
    await repo.upsert(bet('b2', 'bob', 20))
    await repo.remove(BetId('b1'), gameId)

    expect(await repo.listByGame(gameId)).toHaveLength(1)
  })

  it('deletes every bet on a game', async () => {
    const repo = new InMemoryBetRepository()
    await repo.upsert(bet('b1', 'ann', 10))
    await repo.upsert(bet('b2', 'bob', 20))
    await repo.deleteByGame(gameId)

    expect(await repo.listByGame(gameId)).toEqual([])
  })

  it('deletes every bet in a game night', async () => {
    const repo = new InMemoryBetRepository()
    await repo.upsert(bet('b1', 'ann', 10))
    await repo.deleteByGameNight(gameNightId)

    expect(await repo.listByGame(gameId)).toEqual([])
  })
})
