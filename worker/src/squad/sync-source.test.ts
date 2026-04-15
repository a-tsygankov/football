import { describe, expect, it } from 'vitest'
import {
  __TEST_ONLY__,
  buildSquadSnapshotSource,
  extractRosterUpdatePlatformMetadata,
  mapEaTablesToClubs,
} from './sync-source.js'

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
      starRating: 10,
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

  it('builds a full snapshot from the EA roster discovery source', async () => {
    const fetchCalls: Array<{ url: string; headers?: HeadersInit }> = []
    const source = buildSquadSnapshotSource(
      {
        sourceKind: 'ea-rosterupdate-json',
        discoveryUrl: 'https://ea.example/rosterupdate.xml',
        snapshotUrlTemplate: 'https://snapshots.example/{platform}/{version}.json',
        platform: 'PS5',
        retentionCount: 12,
      },
      async (input, init) => {
        const url = typeof input === 'string' ? input : input.url
        fetchCalls.push({ url, headers: init?.headers })
        if (url === 'https://ea.example/rosterupdate.xml') {
          return new Response(
            `
              <squadInfoSet>
                <squadInfo platform="PS5">
                  <dbMajor>fc26-r12</dbMajor>
                  <dbMajorLoc>fc/path/r12.bin</dbMajorLoc>
                </squadInfo>
              </squadInfoSet>
            `,
            {
              status: 200,
              headers: { 'content-type': 'application/xml' },
            },
          )
        }

        return new Response(
          JSON.stringify({
            ...snapshotPayload,
            releasedAt: undefined,
            sourceUrl: undefined,
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
    expect(snapshot.sourceUrl).toBe(
      'https://snapshots.example/PS5/fc26-r12.json',
    )
    expect(fetchCalls.map((call) => call.url)).toEqual([
      'https://ea.example/rosterupdate.xml',
      'https://snapshots.example/PS5/fc26-r12.json',
    ])
  })

  it('maps raw EA squad tables into normalised clubs with placeholder logos', () => {
    const clubs = mapEaTablesToClubs({
      teams: [
        {
          teamId: 11,
          teamName: 'Manchester City',
          overallRating: 88,
          attackRating: 87,
          midfieldRating: 89,
          defenseRating: 86,
          matchdayOverallRating: 88,
          matchdayAttackRating: 87,
          matchdayMidfieldRating: 89,
          matchdayDefenseRating: 86,
        },
        {
          teamId: 12,
          teamName: 'Loose Team',
          overallRating: 60,
          attackRating: 60,
          midfieldRating: 60,
          defenseRating: 60,
          matchdayOverallRating: 60,
          matchdayAttackRating: 60,
          matchdayMidfieldRating: 60,
          matchdayDefenseRating: 60,
        },
      ],
      leagues: [{ leagueId: 13, leagueName: 'Premier League' }],
      leagueTeamLinks: [{ teamId: 11, leagueId: 13 }],
    })

    expect(clubs).toHaveLength(2)
    expect(clubs[0]).toEqual({
      id: 11,
      name: 'Manchester City',
      shortName: 'MAN',
      leagueId: 13,
      leagueName: 'Premier League',
      leagueLogoUrl: null,
      nationId: 0,
      overallRating: 88,
      attackRating: 87,
      midfieldRating: 89,
      defenseRating: 86,
      avatarUrl: null,
      logoUrl: `${__TEST_ONLY__.PENDING_LOGO_PREFIX}11`,
      starRating: 10,
    })
    // Unaffiliated team falls back to leagueId 0 / 'Unknown'.
    expect(clubs[1]?.leagueId).toBe(0)
    expect(clubs[1]?.leagueName).toBe('Unknown')
    expect(clubs[1]?.starRating).toBe(2)
  })

  it('keeps a team in its real league when EA also links it to a classics / specialty bucket', () => {
    // Regression: user reported Premier League showing 35 clubs
    // including classic XIs. EA's binary legitimately lists a team's
    // home league alongside specialty buckets (Classics / Legends /
    // Icons) in `leagueTeamLinks`. The previous implementation built
    // a `new Map(links)` — last-wins on teamId — which randomly
    // bumped real-league teams into specialty ids and vice versa.
    // Now the resolver prefers the non-specialty league.
    const clubs = mapEaTablesToClubs({
      teams: [
        {
          teamId: 11,
          teamName: 'Manchester City',
          overallRating: 88,
          attackRating: 87,
          midfieldRating: 89,
          defenseRating: 86,
          matchdayOverallRating: 88,
          matchdayAttackRating: 87,
          matchdayMidfieldRating: 89,
          matchdayDefenseRating: 86,
        },
      ],
      leagues: [
        { leagueId: 13, leagueName: 'Premier League' },
        { leagueId: 900, leagueName: 'FUT Classic XI' },
      ],
      leagueTeamLinks: [
        // Specialty bucket listed first — a naive last-wins would
        // pick 13 here (which is the right answer) but the moment EA
        // re-orders, the city team would end up in "FUT Classic XI".
        // Listed last-first to reproduce the exact failure mode.
        { teamId: 11, leagueId: 900 },
        { teamId: 11, leagueId: 13 },
      ],
    })
    expect(clubs).toHaveLength(1)
    expect(clubs[0]?.leagueId).toBe(13)
    expect(clubs[0]?.leagueName).toBe('Premier League')
  })

  it('keeps a specialty-only team (Zlatan FC etc.) in its specialty bucket', () => {
    // Complement to the test above: a team whose only linked league
    // is a non-competitive bucket stays there. We must not dump it
    // into leagueId 0 — that would hide it from "Rest of World" type
    // views and silently drop Zlatan FC from every league selector.
    const clubs = mapEaTablesToClubs({
      teams: [
        {
          teamId: 7777,
          teamName: 'Zlatan FC',
          overallRating: 99,
          attackRating: 99,
          midfieldRating: 90,
          defenseRating: 75,
          matchdayOverallRating: 99,
          matchdayAttackRating: 99,
          matchdayMidfieldRating: 90,
          matchdayDefenseRating: 75,
        },
      ],
      leagues: [{ leagueId: 900, leagueName: 'FUT Icons' }],
      leagueTeamLinks: [{ teamId: 7777, leagueId: 900 }],
    })
    expect(clubs[0]?.leagueId).toBe(900)
    expect(clubs[0]?.leagueName).toBe('FUT Icons')
  })

  it('rewrites EA fake names to real identities at ingest time', () => {
    // EA ships Inter Milan as "Lombardia FC" and AC Milan as "Milano FC"
    // for licensing reasons. Both the `name` and the `shortName` must be
    // rewritten so downstream consumers (UI, scoreboard, asset discovery)
    // see canonical identities without having to know about the trick.
    const clubs = mapEaTablesToClubs({
      teams: [
        {
          teamId: 44,
          teamName: 'Lombardia FC',
          overallRating: 85,
          attackRating: 85,
          midfieldRating: 85,
          defenseRating: 83,
          matchdayOverallRating: 85,
          matchdayAttackRating: 85,
          matchdayMidfieldRating: 85,
          matchdayDefenseRating: 83,
        },
        {
          teamId: 45,
          teamName: 'Milano FC',
          overallRating: 83,
          attackRating: 82,
          midfieldRating: 83,
          defenseRating: 82,
          matchdayOverallRating: 83,
          matchdayAttackRating: 82,
          matchdayMidfieldRating: 83,
          matchdayDefenseRating: 82,
        },
      ],
      leagues: [{ leagueId: 31, leagueName: 'Serie A' }],
      leagueTeamLinks: [
        { teamId: 44, leagueId: 31 },
        { teamId: 45, leagueId: 31 },
      ],
    })
    expect(clubs[0]?.name).toBe('Inter Milan')
    expect(clubs[0]?.shortName).toBe('INT')
    expect(clubs[1]?.name).toBe('AC Milan')
    expect(clubs[1]?.shortName).toBe('MIL')
    // The rewrite must not affect the id, league membership, or ratings —
    // only the human-facing name and shortName.
    expect(clubs[0]?.id).toBe(44)
    expect(clubs[0]?.leagueId).toBe(31)
    expect(clubs[0]?.overallRating).toBe(85)
  })

  it('reads the EA roster binary from the location advertised in discovery xml', async () => {
    const fetchCalls: Array<string> = []
    const source = buildSquadSnapshotSource(
      {
        sourceKind: 'ea-rosterupdate-binary',
        discoveryUrl:
          'https://eafc26.content.easports.com/fc/fltOnlineAssets/26E/2026/fc/fclive/genxtitle/rosterupdate.xml',
        platform: 'PS5',
        retentionCount: 12,
      },
      async (input) => {
        const url = typeof input === 'string' ? input : input.url
        fetchCalls.push(url)
        if (url.endsWith('rosterupdate.xml')) {
          return new Response(
            `
              <squadInfoSet>
                <squadInfo platform="PS5">
                  <dbMajor>fc26-r99</dbMajor>
                  <dbMajorLoc>fc/fclive/squads/r99.bin</dbMajorLoc>
                </squadInfo>
              </squadInfoSet>
            `,
            { status: 200, headers: { 'content-type': 'application/xml' } },
          )
        }
        // Garbage binary — we only verify the URL resolution + error path here;
        // the parser has its own tests that cover real binaries.
        return new Response(new Uint8Array([0, 1, 2, 3]).buffer, { status: 200 })
      },
    )

    await expect(source.getLatestSnapshot()).rejects.toThrow()
    expect(fetchCalls).toEqual([
      'https://eafc26.content.easports.com/fc/fltOnlineAssets/26E/2026/fc/fclive/genxtitle/rosterupdate.xml',
      'https://eafc26.content.easports.com/fc/fltOnlineAssets/26E/2026/fc/fclive/squads/r99.bin',
    ])
  })

  it('surfaces a clear error when the EA discovery xml fails', async () => {
    const source = buildSquadSnapshotSource(
      {
        sourceKind: 'ea-rosterupdate-binary',
        discoveryUrl:
          'https://eafc26.content.easports.com/fc/fltOnlineAssets/26E/2026/fc/fclive/genxtitle/rosterupdate.xml',
        platform: 'PS5',
        retentionCount: 12,
      },
      async () => new Response('forbidden', { status: 403 }),
    )

    await expect(source.getLatestSnapshot()).rejects.toThrow(
      /rosterupdate fetch failed with status 403/,
    )
  })
})
