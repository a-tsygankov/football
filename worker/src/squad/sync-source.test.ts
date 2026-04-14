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

  it('builds a full snapshot from a github release asset source', async () => {
    const fetchCalls: Array<{ url: string; headers?: HeadersInit }> = []
    const source = buildSquadSnapshotSource(
      {
        sourceKind: 'github-release-json',
        repository: 'example/fc26-snapshots',
        assetName: 'fc26-latest.json',
        retentionCount: 12,
      },
      async (input, init) => {
        const url = typeof input === 'string' ? input : input.url
        fetchCalls.push({ url, headers: init?.headers })
        if (url.endsWith('/releases/latest')) {
          return new Response(
            JSON.stringify({
              html_url: 'https://github.com/example/fc26-snapshots/releases/tag/fc26-r12',
              published_at: '2026-04-14T06:00:00.000Z',
              assets: [
                {
                  id: 42,
                  name: 'fc26-latest.json',
                  browser_download_url:
                    'https://github.com/example/fc26-snapshots/releases/download/fc26-r12/fc26-latest.json',
                  url: 'https://api.github.com/repos/example/fc26-snapshots/releases/assets/42',
                },
              ],
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          )
        }

        return new Response(
          JSON.stringify({
            ...snapshotPayload,
            releasedAt: undefined,
            sourceUrl: undefined,
            notes: undefined,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      },
    )

    const snapshot = await source.getLatestSnapshot()
    expect(snapshot.version).toBe('fc26-r12')
    expect(snapshot.releasedAt).toBe(Date.parse('2026-04-14T06:00:00.000Z'))
    expect(snapshot.sourceUrl).toBe(
      'https://github.com/example/fc26-snapshots/releases/download/fc26-r12/fc26-latest.json',
    )
    expect(snapshot.notes).toBe('github-release:example/fc26-snapshots')
    expect(fetchCalls.map((call) => call.url)).toEqual([
      'https://api.github.com/repos/example/fc26-snapshots/releases/latest',
      'https://github.com/example/fc26-snapshots/releases/download/fc26-r12/fc26-latest.json',
    ])
  })

  it('rejects the placeholder github repository value before fetching', async () => {
    const source = buildSquadSnapshotSource(
      {
        sourceKind: 'github-release-json',
        repository: 'owner/repo',
        assetName: 'fc26-latest.json',
        retentionCount: 12,
      },
      async () => {
        throw new Error('fetch should not be called for the placeholder repository')
      },
    )

    await expect(source.getLatestSnapshot()).rejects.toThrow(
      'SQUAD_SYNC_GITHUB_REPOSITORY is still set to the placeholder owner/repo',
    )
  })
})
