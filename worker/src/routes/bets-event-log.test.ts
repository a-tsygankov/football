import { describe, expect, it } from 'vitest'
import type {
  BetPlacedEvent,
  BetRemovedEvent,
  BetsDiscardedEvent,
  BetsLockedEvent,
  BetsResponse,
  GameEventPayload,
  PersistedGameEvent,
} from '@fc26/shared'
import {
  buildTestApp,
  req,
  seedLiveGame,
  type LiveGameSeed,
} from './test-support.js'

function betsPath(seed: LiveGameSeed): string {
  return `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets`
}

type App = ReturnType<typeof buildTestApp>

async function events(app: App, roomId: string): Promise<ReadonlyArray<PersistedGameEvent>> {
  return app.events.listByRoom(roomId)
}

function ofType<T extends GameEventPayload['type']>(
  all: ReadonlyArray<PersistedGameEvent>,
  type: T,
): Extract<GameEventPayload, { type: T }>[] {
  return all
    .map((e) => e.payload)
    .filter((p): p is Extract<GameEventPayload, { type: T }> => p.type === type)
}

function place(app: App, seed: LiveGameSeed, gamerId: string, outcome: string, stake: number) {
  return req(app, betsPath(seed), {
    method: 'POST',
    headers: { cookie: seed.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ gamerId, outcome, stake }),
  })
}

describe('bet event log', () => {
  it('records a placed bet with who, what and when', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    await place(app, seed, seed.cy, 'draw', 25)

    const placed = ofType(await events(app, seed.roomId), 'bet_placed') as BetPlacedEvent[]
    expect(placed).toHaveLength(1)
    expect(placed[0]!.gamerId).toBe(seed.cy)
    expect(placed[0]!.outcome).toBe('draw')
    expect(placed[0]!.stake).toBe(25)
    expect(placed[0]!.gameId).toBe(seed.gameId)
    expect(placed[0]!.occurredAt).toBeGreaterThan(0)
    // Nothing was overwritten, so no `replaced`.
    expect(placed[0]!.replaced).toBeUndefined()
  })

  it('preserves the overwritten bet when a gamer re-bets', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    await place(app, seed, seed.cy, 'draw', 25)
    await place(app, seed, seed.cy, 'home', 60)

    // The live table keeps only the latest — one bet per gamer per game.
    const placed = ofType(await events(app, seed.roomId), 'bet_placed') as BetPlacedEvent[]
    expect(placed).toHaveLength(2)

    // ...but the log still knows what the first wager was, which is the whole
    // point: an upsert would otherwise erase it without trace.
    const second = placed[1]!
    expect(second.stake).toBe(60)
    expect(second.outcome).toBe('home')
    expect(second.replaced).toBeDefined()
    expect(second.replaced!.stake).toBe(25)
    expect(second.replaced!.outcome).toBe('draw')
  })

  it('records a removed bet with the stake being undone', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    const placeRes = await place(app, seed, seed.cy, 'draw', 25)
    const betId = ((await placeRes.json()) as BetsResponse).bets[0]!.id

    await req(app, `${betsPath(seed)}/${betId}`, {
      method: 'DELETE',
      headers: { cookie: seed.cookie },
    })

    const removed = ofType(await events(app, seed.roomId), 'bet_removed') as BetRemovedEvent[]
    expect(removed).toHaveLength(1)
    expect(removed[0]!.betId).toBe(betId)
    expect(removed[0]!.gamerId).toBe(seed.cy)
    expect(removed[0]!.stake).toBe(25)
  })

  it('snapshots the whole book when it locks', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    await place(app, seed, seed.cy, 'draw', 25)
    // `ann` plays on the home side, so backing 'home' is the one outcome
    // eligibility allows a participant.
    await place(app, seed, seed.ann, 'home', 75)

    await req(app, `${betsPath(seed)}/lock`, {
      method: 'POST',
      headers: { cookie: seed.cookie },
    })

    const locked = ofType(await events(app, seed.roomId), 'bets_locked') as BetsLockedEvent[]
    expect(locked).toHaveLength(1)
    expect(locked[0]!.bets).toHaveLength(2)
    expect(locked[0]!.pot).toBe(100)
    // After settlement the live rows are deleted, so this snapshot is the only
    // surviving record of what the table was actually playing for.
    expect(locked[0]!.bets.map((b) => b.stake).sort((a, b) => a - b)).toEqual([25, 75])
  })

  it('records a discarded book when a game is interrupted', async () => {
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

    // A wash is not the same as never happening: stakes were committed, and
    // previously the rows were deleted leaving no trace of the book at all.
    const discarded = ofType(
      await events(app, seed.roomId),
      'bets_discarded',
    ) as BetsDiscardedEvent[]
    expect(discarded).toHaveLength(1)
    expect(discarded[0]!.reason).toBe('game_interrupted')
    expect(discarded[0]!.bets).toHaveLength(1)
    expect(discarded[0]!.bets[0]!.stake).toBe(25)
  })

  it('writes no bet events for a game nobody bet on', async () => {
    const app = buildTestApp()
    const seed = await seedLiveGame(app)

    await req(app, `${betsPath(seed)}/lock`, {
      method: 'POST',
      headers: { cookie: seed.cookie },
    })

    const all = await events(app, seed.roomId)
    // An empty book still locks, and that is worth recording; what must not
    // happen is inventing bet rows that never existed.
    const locked = ofType(all, 'bets_locked') as BetsLockedEvent[]
    expect(locked).toHaveLength(1)
    expect(locked[0]!.bets).toHaveLength(0)
    expect(locked[0]!.pot).toBe(0)
    expect(ofType(all, 'bet_placed')).toHaveLength(0)
  })
})
