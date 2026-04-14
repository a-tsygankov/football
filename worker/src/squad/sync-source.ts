import { z } from 'zod'
import {
  extractRosterUpdatePlatformMetadata,
  type Club,
  type FcPlayer,
  type ILogger,
  type RosterUpdatePlatformMetadata,
  type SquadSnapshot,
} from '@fc26/shared'
import type { SquadSyncConfig } from './sync-config.js'

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
  starRating: z.number().int().min(1).max(5),
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
  return {
    version: payload.version,
    releasedAt: payload.releasedAt ?? defaults.fallbackReleasedAt,
    sourceUrl: payload.sourceUrl ?? defaults.fallbackSourceUrl,
    notes: payload.notes ?? defaults.fallbackNotes,
    clubs: payload.clubs,
    players,
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

export const __TEST_ONLY__ = {
  normalizeSnapshotPayload,
  normalizeSnapshotPayloadWithDefaults,
  flattenPlayersByClubId,
  applyTemplate,
}
