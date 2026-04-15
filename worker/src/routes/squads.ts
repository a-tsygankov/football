import { Hono } from 'hono'
import { compareLeagueNames, type SquadLeague } from '@fc26/shared'
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
  const cached = await c.get('deps').squadStorage.getLogoBytes(clubId)
  if (!cached) {
    return c.json({ error: 'not_found', clubId }, 404)
  }
  return new Response(cached.bytes, {
    status: 200,
    headers: {
      'content-type': cached.contentType,
      // Logos never change once cached for a given clubId — they're keyed
      // off the immutable EA team id. Aggressive caching keeps repeat loads
      // off the worker entirely.
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  })
})

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
    grouped.set(club.leagueId, {
      id: club.leagueId,
      name: club.leagueName,
      logoUrl: club.leagueLogoUrl ?? null,
      clubCount: 1,
    })
  }
  return [...grouped.values()].sort((left, right) => compareLeagueNames(left.name, right.name))
}
