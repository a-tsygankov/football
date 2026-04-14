import { z } from 'zod'
import type { Club, FcPlayer, SquadSnapshot } from '@fc26/shared'
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

const gitHubReleaseAssetSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  browser_download_url: z.string().url(),
  url: z.string().url(),
})

const gitHubReleaseSchema = z.object({
  html_url: z.string().url(),
  published_at: z.string().datetime({ offset: true }).nullable().optional(),
  assets: z.array(gitHubReleaseAssetSchema),
})

export interface ISquadSnapshotSource {
  getLatestSnapshot(): Promise<SquadSnapshot>
}

export interface RosterUpdatePlatformMetadata {
  readonly platform: string
  readonly squadVersion: string
  readonly squadLocation: string | null
  readonly futVersion: string | null
  readonly futLocation: string | null
}

export function buildSquadSnapshotSource(
  config: SquadSyncConfig,
  fetchImpl: typeof fetch,
): ISquadSnapshotSource {
  if (config.sourceKind === 'json-snapshot') {
    return new JsonSnapshotSource(fetchImpl, config.sourceUrl)
  }
  if (config.sourceKind === 'ea-rosterupdate-json') {
    return new EaRosterupdateJsonSnapshotSource(fetchImpl, config)
  }
  return new GitHubReleaseJsonSnapshotSource(fetchImpl, config)
}

export function extractRosterUpdatePlatformMetadata(
  xml: string,
  platform: string,
): RosterUpdatePlatformMetadata {
  const escapedPlatform = escapeRegExp(platform)
  const blockPattern = new RegExp(
    `<([A-Za-z0-9:_-]+)[^>]*platform=["']${escapedPlatform}["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    'i',
  )
  const block = blockPattern.exec(xml)?.[2]
  if (!block) {
    throw new Error(`platform ${platform} not found in rosterupdate.xml`)
  }
  const squadVersion = readXmlTag(block, 'dbMajor')
  if (!squadVersion) {
    throw new Error(`platform ${platform} does not expose dbMajor in rosterupdate.xml`)
  }
  return {
    platform,
    squadVersion,
    squadLocation: readXmlTag(block, 'dbMajorLoc'),
    futVersion: readXmlTag(block, 'dbFUTVer'),
    futLocation: readXmlTag(block, 'dbFUTLoc'),
  }
}

class JsonSnapshotSource implements ISquadSnapshotSource {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly sourceUrl: string,
  ) {}

  async getLatestSnapshot(): Promise<SquadSnapshot> {
    const response = await this.fetchImpl(this.sourceUrl)
    if (!response.ok) {
      throw new Error(`snapshot fetch failed with status ${response.status}`)
    }
    const payload = squadSnapshotPayloadSchema.parse(await response.json())
    return normalizeSnapshotPayload(payload, this.sourceUrl)
  }
}

class EaRosterupdateJsonSnapshotSource implements ISquadSnapshotSource {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly config: Extract<SquadSyncConfig, { sourceKind: 'ea-rosterupdate-json' }>,
  ) {}

  async getLatestSnapshot(): Promise<SquadSnapshot> {
    const discoveryResponse = await this.fetchImpl(this.config.discoveryUrl)
    if (!discoveryResponse.ok) {
      throw new Error(
        `rosterupdate fetch failed with status ${discoveryResponse.status}`,
      )
    }
    const xml = await discoveryResponse.text()
    const metadata = extractRosterUpdatePlatformMetadata(xml, this.config.platform)
    const snapshotUrl = applyTemplate(this.config.snapshotUrlTemplate, {
      version: metadata.squadVersion,
      platform: metadata.platform,
    })
    const snapshotResponse = await this.fetchImpl(snapshotUrl)
    if (!snapshotResponse.ok) {
      throw new Error(
        `versioned snapshot fetch failed with status ${snapshotResponse.status}`,
      )
    }
    const payload = squadSnapshotPayloadSchema.parse(await snapshotResponse.json())
    const snapshot = normalizeSnapshotPayload(payload, snapshotUrl)
    if (snapshot.version !== metadata.squadVersion) {
      throw new Error(
        `snapshot version mismatch: expected ${metadata.squadVersion}, got ${snapshot.version}`,
      )
    }
    return snapshot
  }
}

class GitHubReleaseJsonSnapshotSource implements ISquadSnapshotSource {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly config: Extract<SquadSyncConfig, { sourceKind: 'github-release-json' }>,
  ) {}

  async getLatestSnapshot(): Promise<SquadSnapshot> {
    const release = await this.fetchLatestRelease()
    const asset = release.assets.find((entry) => entry.name === this.config.assetName)
    if (!asset) {
      const availableAssets = release.assets.map((entry) => entry.name).sort()
      throw new Error(
        `release asset ${this.config.assetName} not found in ${this.config.repository}; available assets: ${availableAssets.join(', ')}`,
      )
    }

    const snapshotResponse = await this.fetchAsset(asset)
    if (!snapshotResponse.ok) {
      throw new Error(
      `github release asset fetch failed with status ${snapshotResponse.status}`,
      )
    }
    const payload = squadSnapshotPayloadSchema.parse(await snapshotResponse.json())
    return normalizeSnapshotPayloadWithDefaults(payload, {
      fallbackReleasedAt: release.published_at
        ? Date.parse(release.published_at)
        : null,
      fallbackSourceUrl: asset.browser_download_url,
      fallbackNotes: `github-release:${this.config.repository}`,
    })
  }

  private async fetchLatestRelease(): Promise<z.infer<typeof gitHubReleaseSchema>> {
    const response = await this.fetchImpl(
      `https://api.github.com/repos/${this.config.repository}/releases/latest`,
      {
        headers: buildGitHubHeaders(),
      },
    )
    if (!response.ok) {
      throw new Error(
        `github latest release fetch failed with status ${response.status}`,
      )
    }
    return gitHubReleaseSchema.parse(await response.json())
  }

  private fetchAsset(
    asset: z.infer<typeof gitHubReleaseAssetSchema>,
  ): Promise<Response> {
    return this.fetchImpl(asset.browser_download_url)
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

function readXmlTag(xmlBlock: string, tagName: string): string | null {
  const match = new RegExp(`<${tagName}>([^<]+)<\\/${tagName}>`, 'i').exec(xmlBlock)
  return match?.[1]?.trim() ?? null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function applyTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    key in values ? encodeURIComponent(values[key] ?? '') : whole,
  )
}

function buildGitHubHeaders(): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

export const __TEST_ONLY__ = {
  normalizeSnapshotPayload,
  normalizeSnapshotPayloadWithDefaults,
  flattenPlayersByClubId,
  applyTemplate,
  buildGitHubHeaders,
}
