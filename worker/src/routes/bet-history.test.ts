import { describe, expect, it } from 'vitest'
import type { BetHistoryResponse, BetsResponse } from '@fc26/shared'
import {
  buildTestApp,
  placeBet,
  recordResult,
  req,
  seedLiveGame,
  type LiveGameSeed,
} from './test-support.js'

function betsPath(seed: LiveGameSeed): string {
  return `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets`
}

type App = ReturnType<typeof buildTestApp>

function place(app: App, seed: LiveGameSeed, gamerId: string, outcome: string, stake: number) {
  return req(app, betsPath(seed), {
    method: 'POST',
    headers: { cookie: seed.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ gamerId, outcome, stake }),
  })
}

async function history(app: App, seed: LiveGameSeed): Promise<BetHistoryResponse> {
  const res = await req(app, `/api/rooms/${seed.roomId}/bet-history`, {
    headers: { cookie: seed.cookie },
  })
  expect(res.status).toBe(200)
  return (await res.json()) as BetHistoryResponse
}

describe('bet history', () => {
  it('groups a game\'s events into one entry', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    await place(app, seed, seed.cy, 'draw', 25)
    await req(app, `${betsPath(seed)}/lock`, {
      method: 'POST',
      headers: { cookie: seed.cookie },
    })

    const body = await history(app, seed)
    expect(body.games).toHaveLength(1)
    expect(body.games[0]!.gameId).toBe(seed.gameId)
    // Placement and lock belong to the same game's story.
    expect(body.games[0]!.events.map((e) => e.type)).toEqual(['bet_placed', 'bets_locked'])
  })

  it('adds players and settled positions once the game is recorded', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    await place(app, seed, seed.cy, 'home', 40)
    await req(
      app,
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/result`,
      {
        method: 'POST',
        headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ result: 'home', homeScore: 2, awayScore: 1 }),
      },
    )

    const body = await history(app, seed)
    const game = body.games[0]!
    // The bet events alone cannot say who played, or how the pool resolved.
    expect(game.playerIds).toContain(seed.ann)
    expect(game.playerIds).toContain(seed.bob)
    expect(game.settled).toBeDefined()
    expect(game.settled!.some((s) => s.gamerId === seed.cy)).toBe(true)
  })

  it('keeps a discarded book in the ledger', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    await place(app, seed, seed.cy, 'draw', 25)
    await req(
      app,
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/interrupt`,
      {
        method: 'POST',
        headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ comment: 'power cut' }),
      },
    )

    const body = await history(app, seed)
    // Everyone nets zero, but the stake was committed and belongs on record.
    expect(body.games).toHaveLength(1)
    expect(body.games[0]!.events.map((e) => e.type)).toContain('bets_discarded')
    expect(body.games[0]!.settled).toBeUndefined()
  })

  it('omits games nobody bet on', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    await req(
      app,
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/result`,
      {
        method: 'POST',
        headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ result: 'home', homeScore: 1, awayScore: 0 }),
      },
    )

    // A betting ledger should not list games with no betting in them.
    expect((await history(app, seed)).games).toHaveLength(0)
  })

  it('requires a room session', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await req(app, `/api/rooms/${seed.roomId}/bet-history`)
    expect(res.status).toBe(401)
  })

  it('carries the money history: purchases and settlements the bets never show', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await req(app, `/api/rooms/${seed.roomId}/chips/purchases`, {
      method: 'POST',
      headers: { cookie: seed.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ gamerId: seed.cy, amount: 60 }),
    })
    await placeBet(app, seed, seed.ann, 'home', 30)
    await placeBet(app, seed, seed.cy, 'away', 40)
    await recordResult(app, seed, { result: 'home' })
    await req(app, `/api/rooms/${seed.roomId}/chips/settlements`, {
      method: 'POST',
      headers: { cookie: seed.cookie },
    })

    const res = await req(app, `/api/rooms/${seed.roomId}/bet-history`, {
      headers: { cookie: seed.cookie },
    })
    const body = (await res.json()) as BetHistoryResponse

    // The settle-up is one entry naming both sides, not one row per gamer.
    const settlements = body.money.filter((entry) => entry.kind === 'settlement')
    expect(settlements).toHaveLength(1)
    const round = settlements[0]
    if (round?.kind !== 'settlement') throw new Error('expected a settlement')
    expect(round.paid.reduce((sum, p) => sum + p.amount, 0)).toBe(0)

    // The manual purchase is there, and so are the night's buy-ins.
    const purchases = body.money.filter((entry) => entry.kind === 'purchase')
    expect(purchases.some((p) => p.kind === 'purchase' && p.amount === 60)).toBe(true)

    // Newest first.
    const times = body.money.map((entry) => entry.occurredAt)
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })

  it('reports no money history for a room where nothing has been bought or settled', async () => {
    const app = buildTestApp()
    // buyIn 0 issues nothing, so the room genuinely has no chip movements.
    const seed = await seedLiveGame(app, { buyIn: 0 })

    const res = await req(app, `/api/rooms/${seed.roomId}/bet-history`, {
      headers: { cookie: seed.cookie },
    })
    expect(((await res.json()) as BetHistoryResponse).money).toEqual([])
  })
})
