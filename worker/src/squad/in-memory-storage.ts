import type { Club, FcPlayer, SquadDiff, SquadVersion } from '@fc26/shared'
import { cachedJsonKey, clubLogoKey, type ISquadStorage, squadKeys } from './storage.js'

interface LogoEntry {
  readonly bytes: ArrayBuffer
  readonly contentType: string
  readonly sourceUrl: string | null
  readonly sourceEtag: string | null
}

/**
 * In-memory implementation used by tests and by the dev shell when no R2
 * binding is configured. Mirrors the R2 key layout one-for-one so behaviour
 * stays interchangeable: anything observable through the interface should
 * behave identically to the real R2 implementation.
 */
export class InMemorySquadStorage implements ISquadStorage {
  private readonly entries = new Map<string, unknown>()

  async getLatestVersion(): Promise<string | null> {
    const value = this.entries.get(squadKeys('').latestPointer) as
      | { version: string }
      | undefined
    return value?.version ?? null
  }

  async setLatestVersion(version: string): Promise<void> {
    this.entries.set(squadKeys('').latestPointer, { version })
  }

  async clearLatestVersion(): Promise<void> {
    this.entries.delete(squadKeys('').latestPointer)
  }

  async getVersionMetadata(version: string): Promise<SquadVersion | null> {
    const value = this.entries.get(squadKeys(version).metadata) as
      | SquadVersion
      | undefined
    return value ?? null
  }

  async putVersionMetadata(version: SquadVersion): Promise<void> {
    this.entries.set(squadKeys(version.version).metadata, version)
  }

  async getClubs(version: string): Promise<ReadonlyArray<Club> | null> {
    const value = this.entries.get(squadKeys(version).clubs) as
      | ReadonlyArray<Club>
      | undefined
    return value ?? null
  }

  async putClubs(version: string, clubs: ReadonlyArray<Club>): Promise<void> {
    this.entries.set(squadKeys(version).clubs, clubs)
  }

  async getPlayersForClub(
    version: string,
    clubId: number,
  ): Promise<ReadonlyArray<FcPlayer> | null> {
    const value = this.entries.get(squadKeys(version).playersFor(clubId)) as
      | ReadonlyArray<FcPlayer>
      | undefined
    return value ?? null
  }

  async putPlayersForClub(
    version: string,
    clubId: number,
    players: ReadonlyArray<FcPlayer>,
  ): Promise<void> {
    this.entries.set(squadKeys(version).playersFor(clubId), players)
  }

  async getDiff(
    fromVersion: string,
    toVersion: string,
  ): Promise<SquadDiff | null> {
    const value = this.entries.get(squadKeys(toVersion).diffFrom(fromVersion)) as
      | SquadDiff
      | undefined
    return value ?? null
  }

  async putDiff(diff: SquadDiff): Promise<void> {
    this.entries.set(
      squadKeys(diff.toVersion).diffFrom(diff.fromVersion),
      diff,
    )
  }

  async deleteVersion(version: string): Promise<void> {
    const prefix = squadKeys(version).versionPrefix
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key)
    }
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
    const buffer =
      bytes instanceof Uint8Array ? bytes.slice().buffer : bytes
    this.entries.set(clubLogoKey(clubId), {
      bytes: buffer,
      contentType: metadata.contentType,
      sourceUrl: metadata.sourceUrl ?? null,
      sourceEtag: metadata.sourceEtag ?? null,
    } satisfies LogoEntry)
  }

  async getLogoBytes(clubId: number): Promise<{
    readonly bytes: ArrayBuffer
    readonly contentType: string
    readonly sourceUrl: string | null
    readonly sourceEtag: string | null
  } | null> {
    const entry = this.entries.get(clubLogoKey(clubId)) as LogoEntry | undefined
    return entry ?? null
  }

  async getCachedJson<T>(
    key: string,
  ): Promise<{ readonly value: T; readonly cachedAt: number } | null> {
    const entry = this.entries.get(cachedJsonKey(key)) as
      | { value: T; cachedAt: number }
      | undefined
    return entry ?? null
  }

  async putCachedJson<T>(key: string, value: T, cachedAt: number): Promise<void> {
    this.entries.set(cachedJsonKey(key), { value, cachedAt })
  }
}
