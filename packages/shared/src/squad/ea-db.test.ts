import { describe, expect, it } from 'vitest'
import { readEaSquadTables } from './ea-db.js'

describe('readEaSquadTables', () => {
  it('returns empty arrays when requested tables are missing', () => {
    const payload = new Uint8Array([
      0x44, 0x42, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00,
      28, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ])

    expect(readEaSquadTables(payload)).toEqual({
      teams: [],
      leagues: [],
      leagueTeamLinks: [],
      teamFormDiff: [],
    })
  })
})
