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
