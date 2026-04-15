import type { Club, FcPlayer, SquadDiff, SquadVersion } from '@fc26/shared'

/**
 * Storage abstraction for the versioned squad data that lives in R2.
 *
 * Routes depend on this interface, never on R2 directly. Tests use the
 * in-memory implementation; production wraps a real `R2Bucket` from the Worker
 * env. The squad-sync tool also writes through this interface so the same
 * code path is exercised in CI.
 *
 * R2 keys mirror the layout in §10 of the handoff doc:
 *   squads/latest.json                          -> { version }
 *   squads/{version}/metadata.json              -> SquadVersion
 *   squads/{version}/clubs.json                 -> Club[]
 *   squads/{version}/players/{clubId}.json      -> FcPlayer[]
 *   squads/{version}/diff-from-{prev}.json      -> SquadDiff
 */
export interface ISquadStorage {
  /** Returns the latest version tag, or null if nothing has been ingested yet. */
  getLatestVersion(): Promise<string | null>
  /** Atomically sets the latest version pointer. */
  setLatestVersion(version: string): Promise<void>
  /** Clears the latest version pointer after a full reset. */
  clearLatestVersion(): Promise<void>

  /** Reads the canonical metadata manifest for a version, if present. */
  getVersionMetadata(version: string): Promise<SquadVersion | null>
  /** Writes the canonical metadata manifest for a version. */
  putVersionMetadata(version: SquadVersion): Promise<void>

  /** Reads the clubs shard for a specific version. */
  getClubs(version: string): Promise<ReadonlyArray<Club> | null>
  /** Writes the clubs shard for a specific version. */
  putClubs(version: string, clubs: ReadonlyArray<Club>): Promise<void>

  /** Reads the players shard for a single club within a version. */
  getPlayersForClub(
    version: string,
    clubId: number,
  ): Promise<ReadonlyArray<FcPlayer> | null>
  /** Writes the players shard for a single club within a version. */
  putPlayersForClub(
    version: string,
    clubId: number,
    players: ReadonlyArray<FcPlayer>,
  ): Promise<void>

  /** Reads the precomputed diff between two versions, or null if absent. */
  getDiff(
    fromVersion: string,
    toVersion: string,
  ): Promise<SquadDiff | null>
  /** Writes a precomputed diff. */
  putDiff(diff: SquadDiff): Promise<void>

  /** Removes every key under `squads/{version}/`. Used by retention pruning. */
  deleteVersion(version: string): Promise<void>

  /**
   * Stores the binary logo bytes for a club. Logos are version-independent
   * (one club id has one logo across all squad versions) so they live under
   * `squads/logos/{clubId}` instead of `squads/{version}/...`. The optional
   * etag lets the asset refresh service skip re-downloading unchanged badges
   * on subsequent runs.
   */
  putLogoBytes(
    clubId: number,
    bytes: ArrayBuffer | Uint8Array,
    metadata: {
      readonly contentType: string
      readonly sourceUrl?: string | null
      readonly sourceEtag?: string | null
    },
  ): Promise<void>
  /** Returns cached logo bytes (with content type) for a club, or null. */
  getLogoBytes(clubId: number): Promise<{
    readonly bytes: ArrayBuffer
    readonly contentType: string
    readonly sourceUrl: string | null
    readonly sourceEtag: string | null
  } | null>
}

export function squadKeys(version: string) {
  return {
    latestPointer: 'squads/latest.json',
    metadata: `squads/${version}/metadata.json`,
    clubs: `squads/${version}/clubs.json`,
    playersFor: (clubId: number) => `squads/${version}/players/${clubId}.json`,
    diffFrom: (fromVersion: string) =>
      `squads/${version}/diff-from-${fromVersion}.json`,
    versionPrefix: `squads/${version}/`,
  } as const
}

/**
 * Build the R2 key for a club's cached logo bytes. Logos are
 * version-independent, so this lives outside the `squads/{version}/` tree.
 * Exported so tests and the asset-refresh service can assert / purge keys.
 */
export function clubLogoKey(clubId: number): string {
  return `squads/logos/${clubId}`
}
