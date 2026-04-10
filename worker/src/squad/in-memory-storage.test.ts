import { describe, expect, it } from 'vitest'
import type { Club, FcPlayer, SquadDiff } from '@fc26/shared'
import { InMemorySquadStorage } from './in-memory-storage.js'

const club: Club = {
  id: 1,
  name: 'Manchester City',
  shortName: 'MCI',
  leagueId: 13,
  leagueName: 'Premier League',
  nationId: 14,
  overallRating: 89,
  attackRating: 88,
  midfieldRating: 90,
  defenseRating: 87,
  logoUrl: 'https://r2.example/logos/1.png',
  starRating: 5,
}

const player: FcPlayer = {
  id: 100,
  clubId: 1,
  name: 'Erling Haaland',
  position: 'ST',
  nationId: 36,
  overall: 91,
  attributes: {
    pace: 89,
    shooting: 94,
    passing: 65,
    dribbling: 80,
    defending: 45,
    physical: 88,
  },
}

describe('InMemorySquadStorage', () => {
  it('round-trips the latest version pointer', async () => {
    const store = new InMemorySquadStorage()
    expect(await store.getLatestVersion()).toBeNull()
    await store.setLatestVersion('fc26-r12')
    expect(await store.getLatestVersion()).toBe('fc26-r12')
  })

  it('round-trips clubs and players per version', async () => {
    const store = new InMemorySquadStorage()
    await store.putClubs('fc26-r12', [club])
    await store.putPlayersForClub('fc26-r12', 1, [player])

    expect(await store.getClubs('fc26-r12')).toEqual([club])
    expect(await store.getPlayersForClub('fc26-r12', 1)).toEqual([player])
    expect(await store.getClubs('fc26-r11')).toBeNull()
    expect(await store.getPlayersForClub('fc26-r12', 999)).toBeNull()
  })

  it('round-trips a diff and looks it up by both versions', async () => {
    const store = new InMemorySquadStorage()
    const diff: SquadDiff = {
      fromVersion: 'fc26-r11',
      toVersion: 'fc26-r12',
      generatedAt: 1_700_000_000_000,
      playerChanges: [],
      clubChanges: [],
      addedPlayers: [],
      removedPlayers: [],
    }
    await store.putDiff(diff)
    expect(await store.getDiff('fc26-r11', 'fc26-r12')).toEqual(diff)
    expect(await store.getDiff('fc26-r10', 'fc26-r12')).toBeNull()
  })

  it('deleteVersion removes only that version, leaving others intact', async () => {
    const store = new InMemorySquadStorage()
    await store.putClubs('fc26-r11', [club])
    await store.putClubs('fc26-r12', [club])
    await store.putPlayersForClub('fc26-r12', 1, [player])
    await store.putDiff({
      fromVersion: 'fc26-r11',
      toVersion: 'fc26-r12',
      generatedAt: 1,
      playerChanges: [],
      clubChanges: [],
      addedPlayers: [],
      removedPlayers: [],
    })

    await store.deleteVersion('fc26-r12')

    expect(await store.getClubs('fc26-r11')).toEqual([club])
    expect(await store.getClubs('fc26-r12')).toBeNull()
    expect(await store.getPlayersForClub('fc26-r12', 1)).toBeNull()
    expect(await store.getDiff('fc26-r11', 'fc26-r12')).toBeNull()
  })
})
