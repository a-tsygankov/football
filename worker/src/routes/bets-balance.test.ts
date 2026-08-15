import { describe, expect, it } from 'vitest'
import { DEFAULT_BUY_IN, type BetsResponse } from '@fc26/shared'
import {
  buildTestApp,
  placeBet,
  recordResult,
  req,
  seedLiveGame,
  startNextGame,
  type LiveGameSeed,
} from './test-support.js'

interface Refusal {
  error: string
  stake: number
  purchased: number
  balance: number
  committed: number
  available: number
}

async function refusal(res: Response): Promise<Refusal> {
  return (await res.json()) as Refusal
}

/** Ann plays home, so `home` is the only outcome eligibility lets her back. */
async function annBacks(
  app: ReturnType<typeof buildTestApp>,
  seed: LiveGameSeed,
  stake: number,
): Promise<Response> {
  return placeBet(app, seed, seed.ann, 'home', stake)
}

describe('available balance', () => {
  it('refuses a stake larger than the buy-in', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await placeBet(app, seed, seed.cy, 'draw', DEFAULT_BUY_IN + 1)

    expect(res.status).toBe(400)
    const body = await refusal(res)
    expect(body.error).toBe('insufficient_chips')
    expect(body.available).toBe(DEFAULT_BUY_IN)
    expect(body.stake).toBe(DEFAULT_BUY_IN + 1)
  })

  it('allows staking the whole stack', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await placeBet(app, seed, seed.cy, 'draw', DEFAULT_BUY_IN)

    // The limit is what you have, not one short of it.
    expect(res.status).toBe(201)
  })

  it('honours a buy-in chosen for the night', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app, { buyIn: 20 })

    expect((await placeBet(app, seed, seed.cy, 'draw', 21)).status).toBe(400)
    expect((await placeBet(app, seed, seed.cy, 'draw', 20)).status).toBe(201)
  })

  it('adds winnings from a settled game to the stack', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await annBacks(app, seed, 50)
    await placeBet(app, seed, seed.cy, 'draw', 50)
    // Pot of 100 to the only home backer: Ann is up 50 on the night.
    await recordResult(app, seed, { result: 'home', homeScore: 2, awayScore: 1 })

    const next = await startNextGame(app, seed)

    expect((await annBacks(app, next, 151)).status).toBe(400)
    expect((await annBacks(app, next, 150)).status).toBe(201)
  })

  it('takes losses from a settled game out of the stack', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await annBacks(app, seed, 50)
    await placeBet(app, seed, seed.cy, 'draw', 50)
    await recordResult(app, seed, { result: 'home', homeScore: 2, awayScore: 1 })

    const next = await startNextGame(app, seed)

    // Cy's 50 is gone, so the buy-in no longer describes what he can bet.
    const res = await placeBet(app, next, seed.cy, 'draw', 51)
    expect(res.status).toBe(400)
    expect((await refusal(res)).available).toBe(50)
    expect((await placeBet(app, next, seed.cy, 'draw', 50)).status).toBe(201)
  })

  it('limits a top-up by what is left, not by the whole stack', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.cy, 'draw', 60)

    // 50 is under the buy-in but the running total would be 110.
    const refused = await placeBet(app, seed, seed.cy, 'draw', 50)
    expect(refused.status).toBe(400)
    expect((await refusal(refused)).available).toBe(40)

    const allowed = await placeBet(app, seed, seed.cy, 'draw', 40)
    expect(allowed.status).toBe(201)
    expect(((await allowed.json()) as BetsResponse).bets[0]!.stake).toBe(100)
  })

  it('lets an all-in position switch outcome', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.cy, 'draw', DEFAULT_BUY_IN)

    // Available is zero, but these are the same chips being re-committed
    // rather than a second stake — refusing here would trap a gamer on an
    // outcome they no longer want.
    const res = await placeBet(app, seed, seed.cy, 'home', DEFAULT_BUY_IN)

    expect(res.status).toBe(201)
    const body = (await res.json()) as BetsResponse
    expect(body.bets).toHaveLength(1)
    expect(body.bets[0]!.outcome).toBe('home')
    expect(body.bets[0]!.stake).toBe(DEFAULT_BUY_IN)
  })

  it('returns committed stakes to the stack when a game is interrupted', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.cy, 'draw', DEFAULT_BUY_IN)

    await req(
      app,
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/interrupt`,
      {
        method: 'POST',
        headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ comment: 'power cut' }),
      },
    )

    // A wash costs nothing, so the whole stack is available again on the next
    // game. Nothing settled, so there is no net to carry either.
    const next = await startNextGame(app, seed)
    expect((await placeBet(app, next, seed.cy, 'draw', DEFAULT_BUY_IN)).status).toBe(201)
  })

  it('reports the whole picture when it refuses', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.cy, 'draw', 30)

    const body = await refusal(await placeBet(app, seed, seed.cy, 'home', 200))

    // Enough for the client to explain the refusal without a second request.
    expect(body).toMatchObject({
      error: 'insufficient_chips',
      stake: 200,
      purchased: DEFAULT_BUY_IN,
      balance: DEFAULT_BUY_IN,
      committed: 30,
      available: 70,
    })
  })
})
