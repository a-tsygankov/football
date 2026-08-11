import { describe, expect, it } from 'vitest'
import type { GameNightChipsResponse, RoomBootstrapResponse } from '@fc26/shared'
import {
  buildTestApp,
  placeBet,
  recordResult,
  req,
  seedLiveGame,
} from './test-support.js'

describe('chips endpoint', () => {
  it('reports net positions after a settled game', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.ann, 'home', 50)
    await placeBet(app, seed, seed.cy, 'draw', 50)
    await recordResult(app, seed, { result: 'home', homeScore: 2, awayScore: 1 })

    const res = await req(app, `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/chips`, {
      headers: { cookie: seed.cookie },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as GameNightChipsResponse
    expect(body.positions).toEqual(
      expect.arrayContaining([
        { gamerId: seed.ann, net: 50 },
        { gamerId: seed.cy, net: -50 },
      ]),
    )
    expect(body.lastGameDeltas).toEqual(body.positions)
  })

  it('returns empty positions before anything settles', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await req(app, `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/chips`, {
      headers: { cookie: seed.cookie },
    })

    const body = (await res.json()) as GameNightChipsResponse
    expect(body.positions).toEqual([])
  })

  it('excludes a voided game from the standings', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.ann, 'home', 50)
    await recordResult(app, seed, { result: 'home', homeScore: 2, awayScore: 1 })

    await req(
      app,
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/void`,
      {
        method: 'POST',
        headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'mistake' }),
      },
    )

    const res = await req(app, `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/chips`, {
      headers: { cookie: seed.cookie },
    })

    expect(((await res.json()) as GameNightChipsResponse).positions).toEqual([])
  })

  it('includes live bets in the bootstrap payload', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.cy, 'draw', 25)

    const res = await req(app, `/api/rooms/${seed.roomId}/bootstrap`, {
      headers: { cookie: seed.cookie },
    })

    const body = (await res.json()) as RoomBootstrapResponse
    expect(body.bets).toHaveLength(1)
    expect(body.bets[0]!.stake).toBe(25)
  })
})
