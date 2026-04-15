import { z } from 'zod'
import {
  buildEaContentUrl,
  canonicaliseClubName,
  canonicaliseClubs,
  canonicaliseLeagueIds,
  extractRosterUpdatePlatformMetadata,
  readEaSquadTables,
  remapPlayerClubIds,
  starRating10FromOverall,
  unpackEaRosterBinary,
  type Club,
  type EaLeagueRecord,
  type EaTeamRecord,
  type FcPlayer,
  type ILogger,
  type RosterUpdatePlatformMetadata,
  type SquadSnapshot,
} from '@fc26/shared'
import type { SquadSyncConfig } from './sync-config.js'
import { PENDING_LOGO_PREFIX } from './storage.js'

const clubSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  shortName: z.string().min(1),
  leagueId: z.number().int().nonnegative(),
  leagueName: z.string().min(1),
  leagueLogoUrl: z.string().nullable().optional(),
  nationId: z.number().int().nonnegative(),
  overallRating: z.number().int().min(1).max(99),
  attackRating: z.number().int().min(1).max(99),
  midfieldRating: z.number().int().min(1).max(99),
  defenseRating: z.number().int().min(1).max(99),
  avatarUrl: z.string().nullable(),
  logoUrl: z.string().min(1),
  starRating: z.number().int().min(0).max(10),
}) satisfies z.ZodType<Club>

const fcPlayerSchema = z.object({
  id: z.number().int().positive(),
  clubId: z.number().int().positive(),
  name: z.string().min(1),
  avatarUrl: z.string().nullable(),
  position: z.string().min(1),
  nationId: z.number().int().nonnegative(),
  overall: z.number().int().min(1).max(99),
  attributes: z.object({
    pace: z.number().int().min(1).max(99),
    shooting: z.number().int().min(1).max(99),
    passing: z.number().int().min(1).max(99),
    dribbling: z.number().int().min(1).max(99),
    defending: z.number().int().min(1).max(99),
    physical: z.number().int().min(1).max(99),
  }),
}) satisfies z.ZodType<FcPlayer>

const squadSnapshotPayloadSchema = z.object({
  version: z.string().min(1),
  releasedAt: z.number().int().nullable().optional(),
  sourceUrl: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  clubs: z.array(clubSchema),
  players: z.array(fcPlayerSchema).optional(),
  playersByClubId: z.record(z.string(), z.array(fcPlayerSchema)).optional(),
})

export interface ISquadSnapshotSource {
  getLatestSnapshot(): Promise<SquadSnapshot>
}

export { extractRosterUpdatePlatformMetadata }
export type { RosterUpdatePlatformMetadata }

export function buildSquadSnapshotSource(
  config: SquadSyncConfig,
  fetchImpl: typeof fetch,
  logger?: ILogger,
): ISquadSnapshotSource {
  if (config.sourceKind === 'json-snapshot') {
    return new JsonSnapshotSource(fetchImpl, config.sourceUrl, logger)
  }
  if (config.sourceKind === 'ea-rosterupdate-binary') {
    return new EaRosterupdateBinarySnapshotSource(fetchImpl, config, logger)
  }
  return new EaRosterupdateJsonSnapshotSource(fetchImpl, config, logger)
}

class JsonSnapshotSource implements ISquadSnapshotSource {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly sourceUrl: string,
    private readonly logger?: ILogger,
  ) {}

  async getLatestSnapshot(): Promise<SquadSnapshot> {
    this.logger?.info('squad-sync', 'fetching json snapshot', {
      sourceUrl: this.sourceUrl,
    })
    const response = await this.fetchImpl(this.sourceUrl)
    if (!response.ok) {
      throw new Error(`snapshot fetch failed with status ${response.status}`)
    }
    const payload = squadSnapshotPayloadSchema.parse(await response.json())
    this.logger?.info('squad-sync', 'json snapshot payload received', {
      sourceUrl: this.sourceUrl,
      version: payload.version,
      clubCount: payload.clubs.length,
      hasPlayers: Boolean(payload.players),
      hasPlayersByClubId: Boolean(payload.playersByClubId),
    })
    return normalizeSnapshotPayload(payload, this.sourceUrl)
  }
}

class EaRosterupdateBinarySnapshotSource implements ISquadSnapshotSource {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly config: Extract<SquadSyncConfig, { sourceKind: 'ea-rosterupdate-binary' }>,
    private readonly logger?: ILogger,
  ) {}

  async getLatestSnapshot(): Promise<SquadSnapshot> {
    this.logger?.info('squad-sync', 'fetching roster discovery xml', {
      discoveryUrl: this.config.discoveryUrl,
      platform: this.config.platform,
    })
    const discoveryResponse = await this.fetchImpl(this.config.discoveryUrl)
    if (!discoveryResponse.ok) {
      throw new Error(
        `rosterupdate fetch failed with status ${discoveryResponse.status}`,
      )
    }
    const xml = await discoveryResponse.text()
    const metadata = extractRosterUpdatePlatformMetadata(xml, this.config.platform)
    if (!metadata.squadLocation) {
      throw new Error(
        `roster discovery did not advertise a squad binary for platform ${this.config.platform}`,
      )
    }
    const squadUrl = buildEaContentUrl(this.config.discoveryUrl, metadata.squadLocation)
    this.logger?.info('squad-sync', 'fetching ea squad binary', {
      squadUrl,
      expectedVersion: metadata.squadVersion,
    })
    const squadResponse = await this.fetchImpl(squadUrl)
    if (!squadResponse.ok) {
      throw new Error(
        `ea squad binary fetch failed with status ${squadResponse.status}`,
      )
    }
    const rawBytes = new Uint8Array(await squadResponse.arrayBuffer())
    const unpackedBytes = unpackEaRosterBinary(rawBytes)
    const tables = readEaSquadTables(unpackedBytes)
    this.logger?.info('squad-sync', 'ea squad binary parsed', {
      squadUrl,
      version: metadata.squadVersion,
      teamCount: tables.teams.length,
      leagueCount: tables.leagues.length,
      leagueLinkCount: tables.leagueTeamLinks.length,
    })
    const clubs = mapEaTablesToClubs(tables)
    return {
      version: metadata.squadVersion,
      releasedAt: null,
      sourceUrl: squadUrl,
      notes: `EA roster binary, platform ${this.config.platform}`,
      clubs,
      // EA tables don't expose individual fc_player attributes; the asset
      // refresh service backfills logos later. Players stay empty until a
      // future source path provides them.
      players: [],
    }
  }
}

class EaRosterupdateJsonSnapshotSource implements ISquadSnapshotSource {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly config: Extract<SquadSyncConfig, { sourceKind: 'ea-rosterupdate-json' }>,
    private readonly logger?: ILogger,
  ) {}

  async getLatestSnapshot(): Promise<SquadSnapshot> {
    this.logger?.info('squad-sync', 'fetching roster discovery xml', {
      discoveryUrl: this.config.discoveryUrl,
      platform: this.config.platform,
    })
    const discoveryResponse = await this.fetchImpl(this.config.discoveryUrl)
    if (!discoveryResponse.ok) {
      throw new Error(
        `rosterupdate fetch failed with status ${discoveryResponse.status}`,
      )
    }
    const xml = await discoveryResponse.text()
    const metadata = extractRosterUpdatePlatformMetadata(xml, this.config.platform)
    this.logger?.info('squad-sync', 'roster discovery resolved version', {
      discoveryUrl: this.config.discoveryUrl,
      platform: metadata.platform,
      squadVersion: metadata.squadVersion,
      squadLocation: metadata.squadLocation,
    })
    const snapshotUrl = applyTemplate(this.config.snapshotUrlTemplate, {
      version: metadata.squadVersion,
      platform: metadata.platform,
    })
    this.logger?.info('squad-sync', 'fetching versioned snapshot', {
      snapshotUrl,
      expectedVersion: metadata.squadVersion,
    })
    const snapshotResponse = await this.fetchImpl(snapshotUrl)
    if (!snapshotResponse.ok) {
      throw new Error(
        `versioned snapshot fetch failed with status ${snapshotResponse.status}`,
      )
    }
    const payload = squadSnapshotPayloadSchema.parse(await snapshotResponse.json())
    this.logger?.info('squad-sync', 'versioned snapshot payload received', {
      snapshotUrl,
      version: payload.version,
      clubCount: payload.clubs.length,
      hasPlayers: Boolean(payload.players),
      hasPlayersByClubId: Boolean(payload.playersByClubId),
    })
    const snapshot = normalizeSnapshotPayload(payload, snapshotUrl)
    if (snapshot.version !== metadata.squadVersion) {
      throw new Error(
        `snapshot version mismatch: expected ${metadata.squadVersion}, got ${snapshot.version}`,
      )
    }
    return snapshot
  }
}

function normalizeSnapshotPayload(
  payload: z.infer<typeof squadSnapshotPayloadSchema>,
  fallbackSourceUrl: string,
): SquadSnapshot {
  return normalizeSnapshotPayloadWithDefaults(payload, {
    fallbackReleasedAt: null,
    fallbackSourceUrl,
    fallbackNotes: null,
  })
}

function normalizeSnapshotPayloadWithDefaults(
  payload: z.infer<typeof squadSnapshotPayloadSchema>,
  defaults: {
    fallbackReleasedAt: number | null
    fallbackSourceUrl: string
    fallbackNotes: string | null
  },
): SquadSnapshot {
  const players = payload.players ?? flattenPlayersByClubId(payload.playersByClubId)
  if (!players) {
    throw new Error('snapshot payload must contain players or playersByClubId')
  }
  assertNoDuplicateIds(payload.clubs.map((club) => club.id), 'club')
  assertNoDuplicateIds(players.map((player) => player.id), 'player')
  const clubIds = new Set(payload.clubs.map((club) => club.id))
  for (const player of players) {
    if (!clubIds.has(player.clubId)) {
      throw new Error(`player ${player.id} references unknown club ${player.clubId}`)
    }
  }
  // Collapse leagues that share a name but come with multiple raw EA
  // leagueIds (console-vs-handheld variants, regional editions, …).
  // Without this the `leagues` view derived in the worker would render
  // the same league three or four times. Applied here so both source
  // paths (JSON snapshot + EA binary) get consistent behaviour.
  const leagueCanonicalClubs = canonicaliseLeagueIds(payload.clubs)
  // After league canonicalisation, two rows with the same name can land
  // in the same league bucket (e.g. EA ships separate AC Milan rows for
  // console vs. handheld that both alias to "AC Milan"). Dedupe on
  // `(name, leagueId)` so the UI renders each club once, and rewrite
  // every player whose `clubId` pointed at a collapsed row onto the
  // canonical club. Without the player rewrite the downstream
  // `assertNoDuplicateIds` check on players would still pass, but the
  // clubId→player lookup would return nothing for the collapsed ids.
  const { clubs: canonicalClubs, idRemap } = canonicaliseClubs(leagueCanonicalClubs)
  const canonicalPlayers = remapPlayerClubIds(players, idRemap).players
  return {
    version: payload.version,
    releasedAt: payload.releasedAt ?? defaults.fallbackReleasedAt,
    sourceUrl: payload.sourceUrl ?? defaults.fallbackSourceUrl,
    notes: payload.notes ?? defaults.fallbackNotes,
    clubs: canonicalClubs,
    players: canonicalPlayers,
  }
}

function flattenPlayersByClubId(
  playersByClubId: Record<string, FcPlayer[]> | undefined,
): ReadonlyArray<FcPlayer> | null {
  if (!playersByClubId) return null
  return Object.values(playersByClubId).flat()
}

function assertNoDuplicateIds(ids: ReadonlyArray<number>, kind: 'club' | 'player'): void {
  const seen = new Set<number>()
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`duplicate ${kind} id ${id} in snapshot payload`)
    }
    seen.add(id)
  }
}

function applyTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    key in values ? encodeURIComponent(values[key] ?? '') : whole,
  )
}

/**
 * Convert raw EA squad tables into the normalised `Club[]` shape stored in R2.
 * Logos and league badges aren't part of the EA binary — the asset refresh
 * service backfills them via SportsDB after ingestion. Until then we emit a
 * stable `pending:club:{id}` placeholder so the schema's `min(1)` invariant
 * still holds and downstream consumers can detect the placeholder.
 */
export function mapEaTablesToClubs(tables: {
  readonly teams: ReadonlyArray<EaTeamRecord>
  readonly leagues: ReadonlyArray<EaLeagueRecord>
  readonly leagueTeamLinks: ReadonlyArray<{ teamId: number; leagueId: number }>
}): Club[] {
  const leagueById = new Map(tables.leagues.map((league) => [league.leagueId, league]))
  const leagueIdByTeam = new Map(
    tables.leagueTeamLinks.map((link) => [link.teamId, link.leagueId]),
  )
  const seen = new Set<number>()
  const clubs: Club[] = []
  for (const team of tables.teams) {
    if (seen.has(team.teamId)) continue
    seen.add(team.teamId)
    const leagueId = leagueIdByTeam.get(team.teamId) ?? 0
    const league = leagueId ? leagueById.get(leagueId) ?? null : null
    // EA ships a handful of Serie A clubs under fake names (Lombardia FC =
    // Inter, Milano FC = AC Milan, …) because of Konami's eFootball
    // exclusivity. Rewrite to the real identity here, before the record
    // ever reaches storage — every downstream consumer (UI, diff, asset
    // discovery) sees the canonical name. See `club-aliases.ts`.
    const alias = canonicaliseClubName(team.teamName)
    const canonicalName = alias?.name ?? team.teamName
    const canonicalShortName = alias?.shortName ?? deriveShortName(team.teamName)
    clubs.push({
      id: team.teamId,
      name: canonicalName,
      shortName: canonicalShortName,
      leagueId,
      leagueName: league?.leagueName ?? 'Unknown',
      leagueLogoUrl: null,
      nationId: 0,
      overallRating: clampRating(team.overallRating),
      attackRating: clampRating(team.attackRating),
      midfieldRating: clampRating(team.midfieldRating),
      defenseRating: clampRating(team.defenseRating),
      avatarUrl: null,
      logoUrl: `${PENDING_LOGO_PREFIX}${team.teamId}`,
      starRating: starRating10FromOverall(team.overallRating) ?? 0,
    })
  }
  // Collapse leagues that share a name across multiple EA leagueIds, then
  // dedupe clubs that now share `(name, leagueId)` after the merge. The
  // JSON-source path does both inside `normalizeSnapshotPayload`; the
  // binary path skips that function, so we apply them here to keep the
  // ingests producing the same canonical shape. The EA binary path
  // builds no player rows (`players: []`), so `idRemap` is discarded —
  // no downstream references to rewrite at ingest time.
  const leagueCanonical = canonicaliseLeagueIds(clubs)
  return canonicaliseClubs(leagueCanonical).clubs
}

function deriveShortName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'CLB'
  return trimmed.slice(0, 3).toUpperCase()
}

function clampRating(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(99, Math.trunc(value)))
}

export const __TEST_ONLY__ = {
  normalizeSnapshotPayload,
  normalizeSnapshotPayloadWithDefaults,
  flattenPlayersByClubId,
  applyTemplate,
  PENDING_LOGO_PREFIX,
}
