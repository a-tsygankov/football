import type { Club, FcPlayer, SquadDiff, SquadVersion } from '@fc26/shared'
import { clubLogoKey, type ISquadStorage, squadKeys } from './storage.js'

/**
 * R2-backed `ISquadStorage`. Each method maps to one R2 operation; we keep
 * the wrapper thin so the interface is the contract — the implementation has
 * no behaviour worth testing in isolation beyond the JSON round-trip.
 *
 * Note: `deleteVersion` lists keys under the version prefix in pages and
 * deletes them in batches. R2 has a `delete(keys[])` overload but it caps
 * at 1000 keys per call, so we chunk by `LIST_LIMIT` defensively.
 */
const LIST_LIMIT = 1000

export class R2SquadStorage implements ISquadStorage {
  constructor(private readonly bucket: R2Bucket) {}

  async getLatestVersion(): Promise<string | null> {
    const obj = await this.bucket.get(squadKeys('').latestPointer)
    if (!obj) return null
    const value = (await obj.json()) as { version: string }
    return value.version
  }

  async setLatestVersion(version: string): Promise<void> {
    await this.bucket.put(
      squadKeys('').latestPointer,
      JSON.stringify({ version }),
      { httpMetadata: { contentType: 'application/json' } },
    )
  }

  async clearLatestVersion(): Promise<void> {
    await this.bucket.delete(squadKeys('').latestPointer)
  }

  async getVersionMetadata(version: string): Promise<SquadVersion | null> {
    const obj = await this.bucket.get(squadKeys(version).metadata)
    if (!obj) return null
    return (await obj.json()) as SquadVersion
  }

  async putVersionMetadata(version: SquadVersion): Promise<void> {
    await this.bucket.put(
      squadKeys(version.version).metadata,
      JSON.stringify(version),
      { httpMetadata: { contentType: 'application/json' } },
    )
  }

  async getClubs(version: string): Promise<ReadonlyArray<Club> | null> {
    const obj = await this.bucket.get(squadKeys(version).clubs)
    if (!obj) return null
    return (await obj.json()) as ReadonlyArray<Club>
  }

  async putClubs(version: string, clubs: ReadonlyArray<Club>): Promise<void> {
    await this.bucket.put(squadKeys(version).clubs, JSON.stringify(clubs), {
      httpMetadata: { contentType: 'application/json' },
    })
  }

  async getPlayersForClub(
    version: string,
    clubId: number,
  ): Promise<ReadonlyArray<FcPlayer> | null> {
    const obj = await this.bucket.get(squadKeys(version).playersFor(clubId))
    if (!obj) return null
    return (await obj.json()) as ReadonlyArray<FcPlayer>
  }

  async putPlayersForClub(
    version: string,
    clubId: number,
    players: ReadonlyArray<FcPlayer>,
  ): Promise<void> {
    await this.bucket.put(
      squadKeys(version).playersFor(clubId),
      JSON.stringify(players),
      { httpMetadata: { contentType: 'application/json' } },
    )
  }

  async getDiff(
    fromVersion: string,
    toVersion: string,
  ): Promise<SquadDiff | null> {
    const obj = await this.bucket.get(squadKeys(toVersion).diffFrom(fromVersion))
    if (!obj) return null
    return (await obj.json()) as SquadDiff
  }

  async putDiff(diff: SquadDiff): Promise<void> {
    await this.bucket.put(
      squadKeys(diff.toVersion).diffFrom(diff.fromVersion),
      JSON.stringify(diff),
      { httpMetadata: { contentType: 'application/json' } },
    )
  }

  async putLogoBytes(
    clubId: number,
    bytes: ArrayBuffer | Uint8Array,
    metadata: {
      readonly contentType: string
      readonly sourceUrl?: string | null
      readonly sourceEtag?: string | null
    },
  ): Promise<void> {
    const customMetadata: Record<string, string> = {}
    if (metadata.sourceUrl) customMetadata.sourceUrl = metadata.sourceUrl
    if (metadata.sourceEtag) customMetadata.sourceEtag = metadata.sourceEtag
    await this.bucket.put(clubLogoKey(clubId), bytes as ArrayBuffer, {
      httpMetadata: { contentType: metadata.contentType },
      customMetadata,
    })
  }

  async getLogoBytes(clubId: number): Promise<{
    readonly bytes: ArrayBuffer
    readonly contentType: string
    readonly sourceUrl: string | null
    readonly sourceEtag: string | null
  } | null> {
    const obj = await this.bucket.get(clubLogoKey(clubId))
    if (!obj) return null
    const bytes = await obj.arrayBuffer()
    return {
      bytes,
      contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream',
      sourceUrl: obj.customMetadata?.sourceUrl ?? null,
      sourceEtag: obj.customMetadata?.sourceEtag ?? null,
    }
  }

  async deleteVersion(version: string): Promise<void> {
    const prefix = squadKeys(version).versionPrefix
    let cursor: string | undefined
    do {
      const page: R2Objects = await this.bucket.list({
        prefix,
        limit: LIST_LIMIT,
        cursor,
      })
      if (page.objects.length > 0) {
        await this.bucket.delete(page.objects.map((o) => o.key))
      }
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }
}
