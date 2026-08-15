import { describe, expect, it } from 'vitest'
import type { GameRecordedEvent } from '@fc26/shared'
import {
  buildTestApp,
  placeBet,
  recordResult,
  req,
  seedLiveGame,
} from './test-support.js'

describe('wager settlement', () => {
  it('writes settled wagers into the recorded event and clears live bets', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.ann, 'home', 50)
    await placeBet(app, seed, seed.cy, 'draw', 50)

    await recordResult(app, seed, { result: 'home', homeScore: 2, awayScore: 1 })

    const recorded = app.events.events.find(
      (event) => event.payload.type === 'game_recorded',
    )!.payload as GameRecordedEvent
    expect(recorded.wagers).toEqual([
      { gamerId: seed.ann, outcome: 'home', stake: 50, payout: 100 },
      { gamerId: seed.cy, outcome: 'draw', stake: 50, payout: 0 },
    ])
    expect(await app.bets.listByGame(seed.gameId)).toEqual([])
  })

  it('settles a hedger on each side separately', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    // Cy is not playing, so he is the one eligibility lets cover both sides.
    await placeBet(app, seed, seed.cy, 'home', 60)
    await placeBet(app, seed, seed.cy, 'draw', 40)

    await recordResult(app, seed, { result: 'home', homeScore: 2, awayScore: 1 })

    const recorded = app.events.events.find(
      (event) => event.payload.type === 'game_recorded',
    )!.payload as GameRecordedEvent

    // The winning row takes the whole 100 pot; the losing row pays nothing.
    // Paying by gamer rather than by row would have credited 100 twice.
    expect(recorded.wagers).toEqual([
      { gamerId: seed.cy, outcome: 'home', stake: 60, payout: 100 },
      { gamerId: seed.cy, outcome: 'draw', stake: 40, payout: 0 },
    ])
  })

  it('leaves the room no richer after a hedged game', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.ann, 'home', 30)
    await placeBet(app, seed, seed.cy, 'home', 20)
    await placeBet(app, seed, seed.cy, 'away', 50)

    await recordResult(app, seed, { result: 'home', homeScore: 3, awayScore: 0 })

    const recorded = app.events.events.find(
      (event) => event.payload.type === 'game_recorded',
    )!.payload as GameRecordedEvent

    // Chips only move between people; a closed pool must neither create nor
    // destroy them, hedge or no hedge.
    const net = (recorded.wagers ?? []).reduce(
      (sum, wager) => sum + (wager.payout - wager.stake),
      0,
    )
    expect(net).toBe(0)
  })

  it('omits the wagers field when no bets were placed', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    await recordResult(app, seed, { result: 'home', homeScore: 1, awayScore: 0 })

    const recorded = app.events.events.find(
      (event) => event.payload.type === 'game_recorded',
    )!.payload as GameRecordedEvent
    expect(recorded.wagers).toBeUndefined()
  })

  it('discards live bets when the game is interrupted', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.cy, 'draw', 30)

    await req(
      app,
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/interrupt`,
      {
        method: 'POST',
        headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ comment: 'pizza' }),
      },
    )

    expect(await app.bets.listByGame(seed.gameId)).toEqual([])
    const interrupted = app.events.events.find((event) => event.payload.type === 'game_interrupted')
    expect(interrupted).toBeDefined()
  })

  it('refunds every bet when nobody backed the result', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)
    await placeBet(app, seed, seed.ann, 'home', 50)

    await recordResult(app, seed, { result: 'away', homeScore: 0, awayScore: 1 })

    const recorded = app.events.events.find(
      (event) => event.payload.type === 'game_recorded',
    )!.payload as GameRecordedEvent
    expect(recorded.wagers).toEqual([
      { gamerId: seed.ann, outcome: 'home', stake: 50, payout: 50 },
    ])
  })
})
