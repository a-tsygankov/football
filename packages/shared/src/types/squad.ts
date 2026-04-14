/**
 * Squad domain types — shared by the worker, web client, and squad-sync tool.
 *
 * `Club` and `FcPlayer` represent the EA-sourced data after normalisation. They
 * live in R2 (sharded) and are read by `View Teams` mode and the team draw step
 * of the game flow.
 *
 * `SquadVersion` is the D1-side registry row, and `SquadDiff` is the
 * precomputed delta between two consecutive versions used by `Update Changes`
 * mode.
 */

/** EA club / FC team. One row per FC26 club. */
export interface Club {
  readonly id: number
  readonly name: string
  readonly shortName: string
  readonly leagueId: number
  readonly leagueName: string
  /** Optional league badge URL, refreshed separately from squad stat ingests. */
  readonly leagueLogoUrl?: string | null
  readonly nationId: number
  /** 1..99 */
  readonly overallRating: number
  readonly attackRating: number
  readonly midfieldRating: number
  readonly defenseRating: number
  /** Club crest or fallback silhouette shown anywhere an avatar is needed. */
  readonly avatarUrl: string | null
  /** R2 public URL — stable across versions because keyed by club id. */
  readonly logoUrl: string
  /** Math.round(overallRating / 20). */
  readonly starRating: number
}

export type FcPlayerAttributeKey =
  | 'pace'
  | 'shooting'
  | 'passing'
  | 'dribbling'
  | 'defending'
  | 'physical'

export interface FcPlayerAttributes {
  readonly pace: number
  readonly shooting: number
  readonly passing: number
  readonly dribbling: number
  readonly defending: number
  readonly physical: number
}

/** Individual FC26 footballer. Stored under `squads/{version}/players/{clubId}.json`. */
export interface FcPlayer {
  readonly id: number
  readonly clubId: number
  readonly name: string
  /** Headshot or fallback silhouette. */
  readonly avatarUrl: string | null
  /** Position code, e.g. 'ST', 'CAM'. */
  readonly position: string
  readonly nationId: number
  /** 1..99 */
  readonly overall: number
  readonly attributes: FcPlayerAttributes
}

/**
 * Registry row for a single ingested squad version. Lives in D1
 * (`squad_versions` table) and points at the corresponding R2 prefix.
 */
export interface SquadVersion {
  /** Stable tag from the upstream release, e.g. `fc26-r12`. */
  readonly version: string
  /** UTC millis when the upstream release was published; null when unknown. */
  readonly releasedAt: number | null
  /** UTC millis when this Worker wrote the data to R2. */
  readonly ingestedAt: number
  /** Bytes of `clubs.json`, for sanity checks and dashboards. */
  readonly clubsBytes: number
  /** Number of clubs in this version. */
  readonly clubCount: number
  /** Number of fc players in this version. */
  readonly playerCount: number
  /** Source URL the data was downloaded from. */
  readonly sourceUrl: string
  /** Optional notes (e.g. failure reason for partial ingests). */
  readonly notes: string | null
}

/** Field-level change for a player between two squad versions. */
export type FcPlayerChangeField = 'overall' | FcPlayerAttributeKey

export interface FcPlayerFieldChange {
  readonly field: FcPlayerChangeField
  readonly from: number
  readonly to: number
}

export interface FcPlayerDiffEntry {
  readonly playerId: number
  readonly clubId: number
  readonly name: string
  readonly changes: ReadonlyArray<FcPlayerFieldChange>
}

export type ClubChangeField =
  | 'overallRating'
  | 'attackRating'
  | 'midfieldRating'
  | 'defenseRating'
  | 'starRating'

export interface ClubFieldChange {
  readonly clubId: number
  readonly field: ClubChangeField
  readonly from: number
  readonly to: number
}

export interface FcPlayerRosterEntry {
  readonly clubId: number
  readonly playerId: number
  readonly name: string
}

/**
 * Precomputed delta between two squad versions. Generated at ingest time and
 * stored in R2 as `squads/{toVersion}/diff-from-{fromVersion}.json` so the
 * Update Changes mode can render without recomputing on every page load.
 */
export interface SquadDiff {
  readonly fromVersion: string
  readonly toVersion: string
  /** UTC millis. */
  readonly generatedAt: number
  readonly playerChanges: ReadonlyArray<FcPlayerDiffEntry>
  readonly clubChanges: ReadonlyArray<ClubFieldChange>
  readonly addedPlayers: ReadonlyArray<FcPlayerRosterEntry>
  readonly removedPlayers: ReadonlyArray<FcPlayerRosterEntry>
}

/**
 * A full, normalized squad snapshot ready for ingestion.
 *
 * Upstream FC 26 updates are treated as full snapshots in this codebase.
 * Historical diffs are generated during ingest and stored alongside the
 * snapshot; they are not the upstream source of truth.
 */
export interface SquadSnapshot {
  readonly version: string
  readonly releasedAt: number | null
  readonly sourceUrl: string
  readonly notes: string | null
  readonly clubs: ReadonlyArray<Club>
  readonly players: ReadonlyArray<FcPlayer>
}

export interface SquadLeague {
  readonly id: number
  readonly name: string
  readonly logoUrl: string | null
  readonly clubCount: number
}

export type SquadSyncStatus = 'disabled' | 'noop' | 'ingested'

export interface SquadSyncResult {
  readonly status: SquadSyncStatus
  readonly version: string | null
  readonly sourceKind: string | null
  readonly sourceUrl: string | null
  readonly releasedAt: number | null
  readonly previousVersion: string | null
  readonly clubCount: number
  readonly playerCount: number
  readonly retainedVersions: number
}

export interface SquadAssetRefreshResult {
  readonly status: 'refreshed' | 'noop'
  readonly versionCount: number
  readonly clubCount: number
  readonly updatedClubCount: number
  readonly matchedClubCount: number
  readonly matchedLeagueCount: number
  readonly unmatchedClubs: ReadonlyArray<string>
  readonly unmatchedLeagues: ReadonlyArray<string>
}

export interface SquadResetResult {
  readonly status: 'reset' | 'noop'
  readonly deletedVersionCount: number
}
