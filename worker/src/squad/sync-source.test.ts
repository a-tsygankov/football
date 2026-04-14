import { describe, expect, it } from 'vitest'
import { buildSquadSnapshotSource, extractRosterUpdatePlatformMetadata } from './sync-source.js'

const snapshotPayload = {
  version: 'fc26-r12',
  releasedAt: 1_710_000_000_000,
  sourceUrl: 'https://snapshots.example/fc26-r12.json',
  notes: null,
  clubs: [
    {
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
      avatarUrl: null,
      logoUrl: 'https://cdn.example/logos/1.png',
      starRating: 5,
    },
  ],
  playersByClubId: {
    '1': [
      {
        id: 100,
        clubId: 1,
        name: 'Erling Haaland',
        avatarUrl: null,
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
      },
    ],
  },
} as const

describe('squad sync source', () => {
  it('extracts roster update metadata for a platform', () => {
    const xml = `
      <squadInfoSet>
        <squadInfo platform="PC64">
          <dbMajor>fc26-r12</dbMajor>
          <dbMajorLoc>fc/path/r12.bin</dbMajorLoc>
          <dbFUTVer>fut-r3</dbFUTVer>
          <dbFUTLoc>fc/path/fut-r3.bin</dbFUTLoc>
        </squadInfo>
      </squadInfoSet>
    `

    expect(extractRosterUpdatePlatformMetadata(xml, 'PC64')).toEqual({
      platform: 'PC64',
      squadVersion: 'fc26-r12',
      squadLocation: 'fc/path/r12.bin',
      futVersion: 'fut-r3',
      futLocation: 'fc/path/fut-r3.bin',
    })
  })

  it('builds a full snapshot from the json source payload', async () => {
    const source = buildSquadSnapshotSource(
      {
        sourceKind: 'json-snapshot',
        sourceUrl: 'https://snapshots.example/latest.json',
        retentionCount: 12,
      },
      async () =>
        new Response(JSON.stringify(snapshotPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )

    const snapshot = await source.getLatestSnapshot()
    expect(snapshot.version).toBe('fc26-r12')
    expect(snapshot.players).toHaveLength(1)
    expect(snapshot.players[0]?.name).toBe('Erling Haaland')
  })
})
