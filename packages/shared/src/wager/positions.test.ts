import { describe, expect, it } from 'vitest'
import { EVENT_SCHEMA_VERSION, type PersistedGameEvent, type WagerSettlement } from '../types/events.js'
import { EventId, GameId, GameNightId, GamerId, GamerTeamKey, RoomId } from '../types/ids.js'
import { lastSettledGameDeltas, nightChipPositions } from './positions.js'

const roomId = RoomId('room-1')
const nightId = GameNightId('night-1')
const otherNightId = GameNightId('night-2')
const ann = GamerId('ann')
const bob = GamerId('bob')

function side(gamerId: ReturnType<typeof GamerId>) {
  return {
    gamerIds: [gamerId],
    gamerTeamKey: GamerTeamKey(gamerId),
    clubId: 1,
    score: 1,
  }
}

function recorded(
  gameId: string,
  occurredAt: number,
  wagers: WagerSettlement[] | undefined,
  gameNightId = nightId,
): PersistedGameEvent {
  return {
    id: EventId(`event-${gameId}`),
    roomId,
    eventType: 'game_recorded',
    schemaVersion: EVENT_SCHEMA_VERSION,
    correlationId: null,
    occurredAt,
    recordedAt: occurredAt,
    payload: {
      type: 'game_recorded',
      schemaVersion: EVENT_SCHEMA_VERSION,
      gameId: GameId(gameId),
      gameNightId,
      roomId,
      format: '1v1',
      size: 2,
      occurredAt,
      home: side(ann),
      away: side(bob),
      result: 'home',
      squadVersion: 'v1',
      selectionStrategyId: 'manual',
      entryMethod: 'manual',
      ...(wagers ? { wagers } : {}),
    },
  }
}

function voided(gameId: string, occurredAt: number): PersistedGameEvent {
  return {
    id: EventId(`void-${gameId}`),
    roomId,
    eventType: 'game_voided',
    schemaVersion: EVENT_SCHEMA_VERSION,
    correlationId: null,
    occurredAt,
    recordedAt: occurredAt,
    payload: {
      type: 'game_voided',
      schemaVersion: EVENT_SCHEMA_VERSION,
      gameId: GameId(gameId),
      gameNightId: nightId,
      roomId,
      occurredAt,
      reason: 'test',
    },
  }
}

describe('nightChipPositions', () => {
  it('nets payouts against stakes across the night', () => {
    const events = [
      recorded('g1', 100, [
        { gamerId: ann, outcome: 'home', stake: 50, payout: 100 },
        { gamerId: bob, outcome: 'away', stake: 50, payout: 0 },
      ]),
      recorded('g2', 200, [
        { gamerId: ann, outcome: 'away', stake: 20, payout: 0 },
        { gamerId: bob, outcome: 'home', stake: 20, payout: 40 },
      ]),
    ]

    const positions = nightChipPositions(events, nightId)

    expect(positions.get(ann)).toBe(30)
    expect(positions.get(bob)).toBe(-30)
  })

  it('excludes voided games', () => {
    const events = [
      recorded('g1', 100, [
        { gamerId: ann, outcome: 'home', stake: 50, payout: 100 },
        { gamerId: bob, outcome: 'away', stake: 50, payout: 0 },
      ]),
      voided('g1', 150),
    ]

    expect(nightChipPositions(events, nightId).size).toBe(0)
  })

  it('ignores events from other game nights', () => {
    const events = [
      recorded('g1', 100, [{ gamerId: ann, outcome: 'home', stake: 50, payout: 100 }], otherNightId),
    ]

    expect(nightChipPositions(events, nightId).size).toBe(0)
  })

  it('ignores recorded events with no wagers field', () => {
    expect(nightChipPositions([recorded('g1', 100, undefined)], nightId).size).toBe(0)
  })

  it('omits a gamer who never bet', () => {
    const events = [recorded('g1', 100, [{ gamerId: ann, outcome: 'home', stake: 10, payout: 10 }])]

    expect(nightChipPositions(events, nightId).has(bob)).toBe(false)
  })
})

describe('lastSettledGameDeltas', () => {
  it('returns only the most recently settled game', () => {
    const events = [
      recorded('g1', 100, [{ gamerId: ann, outcome: 'home', stake: 50, payout: 100 }]),
      recorded('g2', 200, [{ gamerId: bob, outcome: 'home', stake: 20, payout: 60 }]),
    ]

    const deltas = lastSettledGameDeltas(events, nightId)

    expect(deltas.get(bob)).toBe(40)
    expect(deltas.has(ann)).toBe(false)
  })

  it('skips a voided most-recent game and falls back to the one before', () => {
    const events = [
      recorded('g1', 100, [{ gamerId: ann, outcome: 'home', stake: 50, payout: 100 }]),
      recorded('g2', 200, [{ gamerId: bob, outcome: 'home', stake: 20, payout: 60 }]),
      voided('g2', 250),
    ]

    const deltas = lastSettledGameDeltas(events, nightId)

    expect(deltas.get(ann)).toBe(50)
  })

  it('returns an empty map when nothing has settled', () => {
    expect(lastSettledGameDeltas([], nightId).size).toBe(0)
  })
})
