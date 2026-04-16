import { Hono } from 'hono'
import {
  compareLeagueNames,
  getLeagueCountryName,
  getLeagueNationId,
  isWomensLeague,
  type SquadLeague,
} from '@fc26/shared'
import type { AppContext } from '../app.js'

/**
 * Read-only squad routes. The Update Changes mode and the team draw step both
 * read through here. Writes happen via the cron worker / squad-sync tool, not
 * via the public API.
 *
 * Every endpoint is shaped so that the body returned matches the JSON shape
 * stored in R2 — there's no transform layer between R2 and the wire because
 * the squad-sync pipeline is responsible for normalisation at ingest time.
 */
export const squadRoutes = new Hono<AppContext>()

squadRoutes.get('/squads/versions', async (c) => {
  const versions = await c.get('deps').squadVersions.list()
  return c.json({ versions })
})

squadRoutes.get('/squads/latest', async (c) => {
  const { squadStorage, squadVersions } = c.get('deps')
  const latest = await squadVersions.latest()
  if (!latest) {
    c.get('logger').warn('squad-sync', 'no squad versions ingested yet')
    return c.json({ error: 'no_squad_data' }, 503)
  }
  const clubs = await squadStorage.getClubs(latest.version)
  if (!clubs) {
    c.get('logger').error('squad-sync', 'latest version missing clubs in R2', {
      version: latest.version,
    })
    return c.json({ error: 'squad_data_missing' }, 500)
  }
  return c.json({ version: latest.version, clubs })
})

squadRoutes.get('/squads/:version/clubs', async (c) => {
  const version = c.req.param('version')
  const clubs = await c.get('deps').squadStorage.getClubs(version)
  if (!clubs) return c.json({ error: 'not_found', version }, 404)
  return c.json({ version, clubs })
})

squadRoutes.get('/squads/latest/leagues', async (c) => {
  const { squadStorage, squadVersions } = c.get('deps')
  const latest = await squadVersions.latest()
  if (!latest) {
    c.get('logger').warn('squad-sync', 'no squad versions ingested yet')
    return c.json({ error: 'no_squad_data' }, 503)
  }
  const clubs = await squadStorage.getClubs(latest.version)
  if (!clubs) {
    c.get('logger').error('squad-sync', 'latest version missing clubs in R2', {
      version: latest.version,
    })
    return c.json({ error: 'squad_data_missing' }, 500)
  }
  return c.json({ version: latest.version, leagues: deriveLeagues(clubs) })
})

squadRoutes.get('/squads/:version/leagues', async (c) => {
  const version = c.req.param('version')
  const clubs = await c.get('deps').squadStorage.getClubs(version)
  if (!clubs) return c.json({ error: 'not_found', version }, 404)
  return c.json({ version, leagues: deriveLeagues(clubs) })
})

squadRoutes.get('/squads/:version/players/:clubId', async (c) => {
  const version = c.req.param('version')
  const clubIdRaw = c.req.param('clubId')
  const clubId = Number.parseInt(clubIdRaw, 10)
  if (!Number.isFinite(clubId) || clubId <= 0) {
    return c.json({ error: 'invalid_club_id', clubId: clubIdRaw }, 400)
  }
  const players = await c.get('deps').squadStorage.getPlayersForClub(version, clubId)
  if (!players) return c.json({ error: 'not_found', version, clubId }, 404)
  return c.json({ version, clubId, players })
})

squadRoutes.get('/squads/logos/:clubId', async (c) => {
  const clubIdRaw = c.req.param('clubId')
  const clubId = Number.parseInt(clubIdRaw, 10)
  if (!Number.isFinite(clubId) || clubId <= 0) {
    return c.json({ error: 'invalid_club_id', clubId: clubIdRaw }, 400)
  }
  const { squadStorage, squadVersions } = c.get('deps')
  const cached = await squadStorage.getLogoBytes(clubId)
  if (cached) {
    return new Response(cached.bytes, {
      status: 200,
      headers: {
        'content-type': cached.contentType,
        // Cached badge bytes are immutable per clubId (EA team id never
        // recycles). Aggressive cache + SWR keeps repeat loads off the
        // worker entirely.
        'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    })
  }

  // Fallback: serve a deterministic SVG initials badge so the UI never has
  // a broken `<img>`. The route is hit either before the optional asset
  // refresh has run or when the upstream provider (TheSportsDB) couldn't
  // resolve the badge. Initials come from the latest squad version's club
  // record when available, else from the numeric id (rare).
  //
  // Cache TTL is short so a real logo shows up promptly once a refresh
  // succeeds — without falling back to no caching at all (which would let
  // a viewport full of cards hammer the worker).
  const club = await lookupClubName(squadStorage, squadVersions, clubId)
  const svg = renderClubInitialsSvg({
    clubId,
    name: club?.name ?? null,
    shortName: club?.shortName ?? null,
  })
  return new Response(svg, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  })
})

/**
 * Look up the human-readable club name from the latest stored squad version,
 * or `null` if no version is ingested or the club isn't in it. Used by the
 * SVG fallback to render meaningful initials instead of a numeric id.
 */
async function lookupClubName(
  squadStorage: { getClubs(version: string): Promise<ReadonlyArray<{
    id: number
    name: string
    shortName: string
  }> | null> },
  squadVersions: { latest(): Promise<{ version: string } | null> },
  clubId: number,
): Promise<{ name: string; shortName: string } | null> {
  const latest = await squadVersions.latest()
  if (!latest) return null
  const clubs = await squadStorage.getClubs(latest.version)
  if (!clubs) return null
  const match = clubs.find((club) => club.id === clubId)
  return match ? { name: match.name, shortName: match.shortName } : null
}

/**
 * Build a deterministic SVG initials badge for a club. The hue is derived
 * from the club id so the same club always renders the same colour, and the
 * label is the club's short code (or up to two leading letters of the name).
 *
 * Kept inline (no template engine) so the route stays a single self-contained
 * function — the SVG is small enough that string concatenation is the right
 * tool here, and keeps the response cacheable at the HTTP layer.
 */
function renderClubInitialsSvg(input: {
  clubId: number
  name: string | null
  shortName: string | null
}): string {
  const initials = pickInitials(input.shortName, input.name, input.clubId)
  const hue = hueFromClubId(input.clubId)
  const background = `hsl(${hue} 65% 38%)`
  const accent = `hsl(${hue} 65% 26%)`
  const fontSize = initials.length >= 3 ? 36 : 48
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img"',
    ` aria-label="Club ${input.clubId} badge placeholder">`,
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0%" stop-color="${background}"/>`,
    `<stop offset="100%" stop-color="${accent}"/>`,
    `</linearGradient></defs>`,
    `<rect width="128" height="128" rx="22" fill="url(#bg)"/>`,
    `<text x="64" y="64" text-anchor="middle" dominant-baseline="central"`,
    ` font-family="-apple-system, Segoe UI, Roboto, sans-serif"`,
    ` font-weight="700" font-size="${fontSize}" fill="#fff">${escapeXml(initials)}</text>`,
    '</svg>',
  ].join('')
}

function pickInitials(
  shortName: string | null,
  name: string | null,
  clubId: number,
): string {
  if (shortName && shortName.trim().length > 0) {
    return shortName.trim().toUpperCase().slice(0, 3)
  }
  if (name && name.trim().length > 0) {
    const tokens = name.trim().split(/\s+/).filter(Boolean)
    if (tokens.length >= 2) {
      return (tokens[0]![0]! + tokens[1]![0]!).toUpperCase()
    }
    return name.trim().slice(0, 2).toUpperCase()
  }
  return `#${clubId}`
}

function hueFromClubId(clubId: number): number {
  // Cheap hash → 0..359. Multiplying by a prime spreads adjacent ids across
  // the colour wheel so neighbouring clubs in a list don't all look alike.
  return Math.abs((clubId * 137) % 360)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

squadRoutes.get('/squads/:version/diff', async (c) => {
  const version = c.req.param('version')
  const fromVersion = c.req.query('from')
  if (!fromVersion) {
    return c.json({ error: 'missing_from_version' }, 400)
  }
  const diff = await c.get('deps').squadStorage.getDiff(fromVersion, version)
  if (!diff) {
    return c.json({ error: 'not_found', from: fromVersion, to: version }, 404)
  }
  return c.json(diff)
})

function deriveLeagues(clubs: ReadonlyArray<{
  leagueId: number
  leagueName: string
  leagueLogoUrl?: string | null
}>): ReadonlyArray<SquadLeague> {
  const grouped = new Map<number, SquadLeague>()
  for (const club of clubs) {
    const existing = grouped.get(club.leagueId)
    if (existing) {
      grouped.set(club.leagueId, {
        ...existing,
        clubCount: existing.clubCount + 1,
        logoUrl: existing.logoUrl ?? club.leagueLogoUrl ?? null,
      })
      continue
    }
    const nationId = getLeagueNationId(club.leagueId) ?? undefined
    grouped.set(club.leagueId, {
      id: club.leagueId,
      name: club.leagueName,
      logoUrl: club.leagueLogoUrl ?? null,
      clubCount: 1,
      nationId,
      gender: isWomensLeague(club.leagueId) ? 'women' : 'men',
      countryName: getLeagueCountryName(club.leagueId),
    })
  }
  return [...grouped.values()].sort((left, right) => compareLeagueNames(left.name, right.name))
}
