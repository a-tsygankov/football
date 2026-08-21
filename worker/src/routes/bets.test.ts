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

  it('opens a second position when a gamer backs another outcome', async () => {
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

    // Covering a second outcome is a hedge, not a change of mind: both stakes
    // stand and the pot holds 85.
    const body = (await res.json()) as BetsResponse
    expect(body.bets).toHaveLength(2)
    expect(
      body.bets.map((item) => [item.outcome, item.stake]).sort(),
    ).toEqual([['draw', 25], ['home', 60]])
  })

  it('adds to the position when backing the same outcome again', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    const place = (outcome: string, stake: number) =>
      req(app, betsPath(seed), {
        method: 'POST',
        headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ gamerId: seed.cy, outcome, stake }),
      })

    await place('draw', 25)
    const res = await place('draw', 20)

    // "Another 20 on draw" means 20 more, not a silent reset to 20.
    const body = (await res.json()) as BetsResponse
    expect(body.bets).toHaveLength(1)
    expect(body.bets[0]!.stake).toBe(45)
    expect(body.bets[0]!.outcome).toBe('draw')
  })

  it('keeps the same bet identity across a top-up', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    const place = (stake: number) =>
      req(app, betsPath(seed), {
        method: 'POST',
        headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ gamerId: seed.cy, outcome: 'draw', stake }),
      })

    const first = (await (await place(25)).json()) as BetsResponse
    const second = (await (await place(20)).json()) as BetsResponse

    // A top-up is the same position, not a new one — the bet event log and
    // the delete route both key off this id.
    expect(second.bets[0]!.id).toBe(first.bets[0]!.id)
    expect(second.bets[0]!.createdAt).toBe(first.bets[0]!.createdAt)
    expect(second.bets[0]!.updatedAt).toBeGreaterThanOrEqual(first.bets[0]!.updatedAt)
  })

  it('caps the total, not just the increment', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app, { buyIn: 1_000_000 })
    const place = (stake: number) =>
      req(app, betsPath(seed), {
        method: 'POST',
        headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ gamerId: seed.cy, outcome: 'draw', stake }),
      })

    await place(1_000_000)
    // Each increment is individually legal, so without a check on the running
    // total repeated top-ups would walk past the cap that keeps stake * pot
    // inside exact-integer range during settlement.
    const res = await place(1)

    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('stake_cap_exceeded')
  })

  it('tops up only the position on the outcome being backed', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    const place = (outcome: string, stake: number) =>
      req(app, betsPath(seed), {
        method: 'POST',
        headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ gamerId: seed.cy, outcome, stake }),
      })

    await place('draw', 25)
    await place('home', 20)
    const res = await place('home', 15)

    // A top-up must find the right side of the hedge and leave the other
    // alone.
    const body = (await res.json()) as BetsResponse
    expect(body.bets).toHaveLength(2)
    const byOutcome = new Map(body.bets.map((item) => [item.outcome, item.stake]))
    expect(byOutcome.get('home')).toBe(35)
    expect(byOutcome.get('draw')).toBe(25)
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
