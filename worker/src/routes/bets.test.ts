import { describe, expect, it } from 'vitest'
import type { BetsResponse } from '@fc26/shared'
import {
  buildTestApp,
  createGamer,
  placeBet,
  req,
  seedLiveGame,
  type LiveGameSeed,
} from './test-support.js'

function betsPath(seed: LiveGameSeed): string {
  return `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets`
}

describe('bet routes', () => {
  it('places a bet and returns the book', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await req(app, betsPath(seed), {
      method: 'POST',
      headers: { cookie: seed.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ gamerId: seed.cy, outcome: 'draw', stake: 25 }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as BetsResponse
    expect(body.bets).toHaveLength(1)
    expect(body.bets[0]!.stake).toBe(25)
    expect(body.betsLockedAt).toBeNull()
  })

  it('replaces a repeat bet by the same gamer', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    const place = (outcome: string, stake: number) =>
      req(app, betsPath(seed), {
        method: 'POST',
        headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ gamerId: seed.cy, outcome, stake }),
      })

    await place('draw', 25)
    const res = await place('home', 60)

    const body = (await res.json()) as BetsResponse
    expect(body.bets).toHaveLength(1)
    expect(body.bets[0]!.stake).toBe(60)
    expect(body.bets[0]!.outcome).toBe('home')
  })

  it('rejects a participant backing another outcome', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await placeBet(app, seed, seed.ann, 'away', 10)

    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toEqual({ error: 'outcome_not_allowed' })
  })

  it('rejects a participant backing a draw', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await placeBet(app, seed, seed.ann, 'draw', 10)

    expect(res.status).toBe(400)
  })

  it('lets a participant back their own side', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await placeBet(app, seed, seed.ann, 'home', 10)

    expect(res.status).toBe(201)
  })

  it.each([0, -5, 2.5, 1_000_001])('rejects a stake of %s', async (stake) => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await req(app, betsPath(seed), {
      method: 'POST',
      headers: { cookie: seed.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ gamerId: seed.cy, outcome: 'draw', stake }),
    })

    expect(res.status).toBe(400)
  })

  it('rejects a gamer outside the night pool', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    // Add a fourth gamer to the room but not to the night's pool. Creating an
    // active gamer during a live night auto-appends them to the pool, so the
    // outsider has to start inactive.
    const outsiderRes = await req(app, `/api/rooms/${seed.roomId}/gamers`, {
      method: 'POST',
      headers: { cookie: seed.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Dee', active: false }),
    })
    const outsider = ((await outsiderRes.json()) as { gamer: { id: string } }).gamer.id

    const res = await req(app, betsPath(seed), {
      method: 'POST',
      headers: { cookie: seed.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ gamerId: outsider, outcome: 'draw', stake: 10 }),
    })

    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toEqual({ error: 'gamer_not_in_pool' })
  })

  it('removes a bet', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    const placed = (await (await placeBet(app, seed, seed.cy, 'draw', 25)).json()) as BetsResponse
    const betId = placed.bets[0]!.id

    const res = await req(app, `${betsPath(seed)}/${betId}`, {
      method: 'DELETE',
      headers: { cookie: seed.cookie },
    })

    expect(res.status).toBe(200)
    expect(((await res.json()) as BetsResponse).bets).toEqual([])
  })

  it('locks the book and rejects later bets', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const lock = await req(app, `${betsPath(seed)}/lock`, {
      method: 'POST',
      headers: { cookie: seed.cookie },
    })
    expect(lock.status).toBe(200)
    expect(((await lock.json()) as BetsResponse).betsLockedAt).toBeTypeOf('number')

    const late = await placeBet(app, seed, seed.cy, 'draw', 10)
    expect(late.status).toBe(409)
    expect((await late.json()) as { error: string }).toEqual({ error: 'bets_locked' })
  })

  it('is idempotent when locking twice', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    const lockUrl = `${betsPath(seed)}/lock`

    const first = (await (
      await req(app, lockUrl, { method: 'POST', headers: { cookie: seed.cookie } })
    ).json()) as BetsResponse
    const second = (await (
      await req(app, lockUrl, { method: 'POST', headers: { cookie: seed.cookie } })
    ).json()) as BetsResponse

    expect(second.betsLockedAt).toBe(first.betsLockedAt)
  })

  it('rejects a bet without a room session', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await req(app, betsPath(seed), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gamerId: seed.cy, outcome: 'draw', stake: 10 }),
    })

    expect(res.status).toBe(401)
  })
})
