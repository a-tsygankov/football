import { describe, expect, it } from 'vitest'
import { WorkerLogger } from '../logger.js'
import { InMemorySquadStorage } from './in-memory-storage.js'
import { SquadSyncService } from './sync-service.js'
import { InMemorySquadVersionRepository } from './version-repository.js'

const snapshotV11 = {
  version: 'fc26-r11',
  releasedAt: 1_710_000_000_000,
  sourceUrl: 'https://snapshots.example/fc26-r11.json',
  notes: null,
  clubs: [
    {
      id: 1,
      name: 'Manchester City',
      shortName: 'MCI',
      leagueId: 13,
      leagueName: 'Premier League',
      nationId: 14,
      overallRating: 88,
      attackRating: 87,
      midfieldRating: 89,
      defenseRating: 86,
      avatarUrl: null,
      logoUrl: 'https://cdn.example/logos/1.png',
      starRating: 4,
    },
  ],
  players: [
    {
      id: 100,
      clubId: 1,
      name: 'Erling Haaland',
      avatarUrl: null,
      position: 'ST',
      nationId: 36,
      overall: 90,
      attributes: {
        pace: 88,
        shooting: 93,
        passing: 65,
        dribbling: 80,
        defending: 45,
        physical: 88,
      },
    },
  ],
} as const

const snapshotV12 = {
  ...snapshotV11,
  version: 'fc26-r12',
  sourceUrl: 'https://snapshots.example/fc26-r12.json',
  clubs: [
    {
      ...snapshotV11.clubs[0],
      overallRating: 89,
      attackRating: 88,
      midfieldRating: 90,
      defenseRating: 87,
      starRating: 5,
    },
  ],
  players: [
    {
      ...snapshotV11.players[0],
      overall: 91,
      attributes: {
        ...snapshotV11.players[0].attributes,
        pace: 89,
        shooting: 94,
      },
    },
  ],
} as const

describe('SquadSyncService', () => {
  it('ingests a fresh snapshot, updates latest, and stores a diff from the previous version', async () => {
    const squadStorage = new InMemorySquadStorage()
    const squadVersions = new InMemorySquadVersionRepository()
    let payload = snapshotV11

    const service = new SquadSyncService({
      config: {
        sourceKind: 'json-snapshot',
        sourceUrl: 'https://snapshots.example/latest.json',
        retentionCount: 12,
      },
      fetchImpl: async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      logger: new WorkerLogger('test-sync'),
      now: () => 1_720_000_000_000,
      squadStorage,
      squadVersions,
    })

    const first = await service.syncLatest()
    expect(first.status).toBe('ingested')
    expect(await squadStorage.getLatestVersion()).toBe('fc26-r11')
    expect(await squadVersions.get('fc26-r11')).not.toBeNull()

    payload = snapshotV12
    const second = await service.syncLatest()
    expect(second.status).toBe('ingested')
    expect(second.previousVersion).toBe('fc26-r11')
    expect(await squadStorage.getLatestVersion()).toBe('fc26-r12')

    const diff = await squadStorage.getDiff('fc26-r11', 'fc26-r12')
    expect(diff).not.toBeNull()
    expect(diff?.playerChanges).toHaveLength(1)
    expect(diff?.clubChanges).not.toHaveLength(0)
  })

  it('returns noop when the latest version is already stored', async () => {
    const service = new SquadSyncService({
      config: {
        sourceKind: 'json-snapshot',
        sourceUrl: 'https://snapshots.example/latest.json',
        retentionCount: 12,
      },
      fetchImpl: async () =>
        new Response(JSON.stringify(snapshotV11), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      logger: new WorkerLogger('test-sync-noop'),
      now: () => 1_720_000_000_000,
      squadStorage: new InMemorySquadStorage(),
      squadVersions: new InMemorySquadVersionRepository(),
    })

    expect((await service.syncLatest()).status).toBe('ingested')
    expect((await service.syncLatest()).status).toBe('noop')
  })

  it('prunes versions beyond the retention window', async () => {
    const squadStorage = new InMemorySquadStorage()
    const squadVersions = new InMemorySquadVersionRepository()
    const snapshots = [snapshotV11, snapshotV12] as const
    let index = 0

    const service = new SquadSyncService({
      config: {
        sourceKind: 'json-snapshot',
        sourceUrl: 'https://snapshots.example/latest.json',
        retentionCount: 1,
      },
      fetchImpl: async () =>
        new Response(JSON.stringify(snapshots[index++] ?? snapshots[1]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      logger: new WorkerLogger('test-sync-retention'),
      now: () => 1_720_000_000_000 + index,
      squadStorage,
      squadVersions,
    })

    await service.syncLatest()
    await service.syncLatest()

    expect(await squadVersions.get('fc26-r11')).toBeNull()
    expect(await squadVersions.get('fc26-r12')).not.toBeNull()
    expect(await squadStorage.getClubs('fc26-r11')).toBeNull()
    expect(await squadStorage.getLatestVersion()).toBe('fc26-r12')
  })
})
