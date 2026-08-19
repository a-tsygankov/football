import { describe, expect, it } from 'vitest'
import { DEFAULT_BUY_IN, type ChipLedgerResponse } from '@fc26/shared'
import {
  buildTestApp,
  cookieFrom,
  createGamer,
  placeBet,
  recordResult,
  req,
  seedLiveGame,
  startNextGame,
  type LiveGameSeed,
} from './test-support.js'

type App = ReturnType<typeof buildTestApp>

async function ledger(app: App, roomId: string, cookie: string): Promise<ChipLedgerResponse> {
  const res = await req(app, `/api/rooms/${roomId}/chips-ledger`, { headers: { cookie } })
  expect(res.status).toBe(200)
  return (await res.json()) as ChipLedgerResponse
}

function balanceOf(body: ChipLedgerResponse, gamerId: string): number {
  return body.entries.find((entry) => entry.gamerId === gamerId)?.balance ?? 0
}

async function buy(
  app: App,
  seed: LiveGameSeed,
  gamerId: string,
  amount: number,
): Promise<Response> {
  return req(app, `/api/rooms/${seed.roomId}/chips/purchases`, {
    method: 'POST',
    headers: { cookie: seed.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ gamerId, amount }),
  })
}

describe('chip ledger', () => {
  it('issues a buy-in to everyone in the pool when a night starts', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const body = await ledger(app, seed.roomId, seed.cookie)
    expect(body.entries).toHaveLength(3)
    for (const entry of body.entries) {
      expect(entry.purchased).toBe(DEFAULT_BUY_IN)
      expect(entry.balance).toBe(DEFAULT_BUY_IN)
      // Granted, not bought — nobody chose to put this in, and the Wager page
      // uses the difference to decide whether they belong on the list at all.
      expect(entry.granted).toBe(DEFAULT_BUY_IN)
      expect(entry.bought).toBe(0)
    }
  })

  it('reports a manual purchase as bought rather than granted', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    expect((await buy(app, seed, seed.cy, 60)).status).toBe(201)

    const entry = (await ledger(app, seed.roomId, seed.cookie)).entries.find(
      (item) => item.gamerId === seed.cy,
    )
    expect(entry?.granted).toBe(DEFAULT_BUY_IN)
    expect(entry?.bought).toBe(60)
    expect(entry?.purchased).toBe(DEFAULT_BUY_IN + 60)
  })

  it('issues nothing when a night names no buy-in, because zero is the default', async () => {
    const app = buildTestApp()
    const createRes = await req(app, '/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Quiet Night' }),
    })
    const { room } = (await createRes.json()) as { room: { id: string } }
    const cookie = cookieFrom(createRes)
    const ann = await createGamer(app, room.id, cookie, 'Ann')
    const bob = await createGamer(app, room.id, cookie, 'Bob')

    // Deliberately no `buyIn`. Balances are room-wide and carry between
    // nights, so granting a stack every evening would mint chips for people
    // who never wagered — `seedLiveGame` asks for one explicitly precisely
    // because the default no longer provides it.
    const nightRes = await req(
      app,
      `/api/rooms/${room.id}/game-nights`,
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ activeGamerIds: [ann, bob] }),
      },
    )
    expect(nightRes.status).toBe(201)
    const { gameNight } = (await nightRes.json()) as { gameNight: { buyIn: number } }
    expect(gameNight.buyIn).toBe(0)

    expect((await ledger(app, room.id, cookie)).entries).toHaveLength(0)
  })

  it('issues nothing when a night starts with a buy-in of zero', async () => {
    const app = buildTestApp()
    // Which is the point of allowing zero: a room that carries balances over
    // does not want a fresh stack handed out every week.
    const seed = await seedLiveGame(app, { buyIn: 0 })

    expect((await ledger(app, seed.roomId, seed.cookie)).entries).toHaveLength(0)
  })

  it('lets a gamer buy more chips mid-night', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    // Already all-in on the stack they started with.
    await placeBet(app, seed, seed.cy, 'draw', DEFAULT_BUY_IN)
    expect((await placeBet(app, seed, seed.cy, 'draw', 30)).status).toBe(400)

    expect((await buy(app, seed, seed.cy, 50)).status).toBe(201)

    // Running dry mid-evening is exactly when someone buys in again, so this
    // must not have to wait for the next night.
    const topUp = await placeBet(app, seed, seed.cy, 'draw', 30)
    expect(topUp.status).toBe(201)

    const body = await ledger(app, seed.roomId, seed.cookie)
    const cy = body.entries.find((entry) => entry.gamerId === seed.cy)!
    expect(cy.purchased).toBe(DEFAULT_BUY_IN + 50)
    expect(cy.committed).toBe(DEFAULT_BUY_IN + 30)
    expect(cy.available).toBe(20)
  })

  it('carries a balance into the next game night', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    // Ann backs herself and wins the whole 150 pot; Cy loses 50.
    await placeBet(app, seed, seed.ann, 'home', 100)
    await placeBet(app, seed, seed.cy, 'draw', 50)
    await recordResult(app, seed, { result: 'home', homeScore: 2, awayScore: 1 })

    const afterFirst = await ledger(app, seed.roomId, seed.cookie)
    expect(balanceOf(afterFirst, seed.ann)).toBe(150)
    expect(balanceOf(afterFirst, seed.cy)).toBe(50)

    // End the night and start another with no buy-in at all.
    await app.gameNights.complete(seed.nightId as never, Date.now())
    const nextNight = await req(app, `/api/rooms/${seed.roomId}/game-nights`, {
      method: 'POST',
      headers: { cookie: seed.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ activeGamerIds: [seed.ann, seed.bob, seed.cy], buyIn: 0 }),
    })
    expect(nextNight.status).toBe(201)

    // Nothing reset at the boundary — which is the whole point of a ledger
    // that lives on the room rather than on the night.
    const afterSecond = await ledger(app, seed.roomId, seed.cookie)
    expect(balanceOf(afterSecond, seed.ann)).toBe(150)
    expect(balanceOf(afterSecond, seed.cy)).toBe(50)
  })

  it('reports who pays whom to settle up', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    await placeBet(app, seed, seed.ann, 'home', 100)
    await placeBet(app, seed, seed.cy, 'draw', 50)
    await recordResult(app, seed, { result: 'home', homeScore: 2, awayScore: 1 })

    const body = await ledger(app, seed.roomId, seed.cookie)
    expect(body.transfers).toEqual([{ from: seed.cy, to: seed.ann, amount: 50 }])
  })

  it('has nothing to settle while a bet is still riding', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.cy, 'draw', 50)

    const body = await ledger(app, seed.roomId, seed.cookie)
    // Committed, but neither won nor lost — settling now would be a guess.
    expect(body.transfers).toEqual([])
    expect(body.entries.find((entry) => entry.gamerId === seed.cy)!.committed).toBe(50)
  })

  it('returns stakes to the buyer when a game is interrupted', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.cy, 'draw', 50)

    await req(
      app,
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/interrupt`,
      {
        method: 'POST',
        headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ comment: 'power cut' }),
      },
    )
    await startNextGame(app, seed)

    const body = await ledger(app, seed.roomId, seed.cookie)
    expect(balanceOf(body, seed.cy)).toBe(DEFAULT_BUY_IN)
    expect(body.entries.find((entry) => entry.gamerId === seed.cy)!.committed).toBe(0)
  })

  it('buys in a gamer added to the pool after the night started', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    const late = await createGamer(app, seed.roomId, seed.cookie, 'Dex')

    await req(app, `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/active-gamers`, {
      method: 'PATCH',
      headers: { cookie: seed.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ activeGamerIds: [seed.ann, seed.bob, seed.cy, late] }),
    })

    // Balances are the room's now, so arriving late used to mean sitting down
    // with nothing and being unable to bet at all.
    const body = await ledger(app, seed.roomId, seed.cookie)
    expect(balanceOf(body, late)).toBe(DEFAULT_BUY_IN)
  })

  it('does not mint a second stack when a gamer is removed and added back', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    const patch = (ids: string[]) =>
      req(app, `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/active-gamers`, {
        method: 'PATCH',
        headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ activeGamerIds: ids }),
      })

    // Cy is not playing the live game, so he is the one who can be dropped.
    await patch([seed.ann, seed.bob])
    await patch([seed.ann, seed.bob, seed.cy])

    // Guarding on "was not in the pool a moment ago" would hand out chips
    // every time someone was toggled off and on.
    const body = await ledger(app, seed.roomId, seed.cookie)
    expect(balanceOf(body, seed.cy)).toBe(DEFAULT_BUY_IN)
  })

  it('issues nothing on a pool change when the night had no buy-in', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app, { buyIn: 0 })
    const late = await createGamer(app, seed.roomId, seed.cookie, 'Dex')

    await req(app, `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/active-gamers`, {
      method: 'PATCH',
      headers: { cookie: seed.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ activeGamerIds: [seed.ann, seed.bob, seed.cy, late] }),
    })

    expect((await ledger(app, seed.roomId, seed.cookie)).entries).toHaveLength(0)
  })

  it('refuses a purchase for someone outside the room', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await buy(app, seed, 'not-a-gamer', 50)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('unknown_gamer')
  })

  it('refuses a purchase without a room session', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const res = await req(app, `/api/rooms/${seed.roomId}/chips/purchases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gamerId: seed.cy, amount: 50 }),
    })
    expect(res.status).toBe(401)
  })
})
