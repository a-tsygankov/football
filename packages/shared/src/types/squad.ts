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
  /**
   * Star rating on the 0–10 half-star scale (0 = no stars, 10 = five full
   * stars). Derived from `overallRating` via `starRating10FromOverall` at
   * ingest; persisted alongside the club so consumers don't need to
   * re-derive. See `packages/shared/src/squad/stars.ts` for the table.
   */
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

export interface SquadVersionsResponse {
  readonly versions: ReadonlyArray<SquadVersion>
}

export interface SquadClubsResponse {
  readonly version: string
  readonly clubs: ReadonlyArray<Club>
}

export interface SquadLeaguesResponse {
  readonly version: string
  readonly leagues: ReadonlyArray<SquadLeague>
}

export interface SquadPlayersResponse {
  readonly version: string
  readonly clubId: number
  readonly players: ReadonlyArray<FcPlayer>
}

export type SquadSyncStatus = 'disabled' | 'noop' | 'ingested'

export interface SquadSyncResult {
  readonly status: SquadSyncStatus
  readonly version: string | null
  readonly sourceKind: string | null
  readonly sourceUrl: string | null
  readonly platform: string | null
  readonly releasedAt: number | null
  readonly previousVersion: string | null
  readonly clubCount: number
  readonly playerCount: number
  readonly retainedVersions: number
}

export interface SquadAssetRefreshResult {
  readonly status: 'refreshed' | 'noop'
  readonly versionCount: number
  /** Total distinct clubs considered across all stored squad versions. */
  readonly clubCount: number
  /** Clubs whose stored record was rewritten (new logo / league name / badge). */
  readonly updatedClubCount: number
  /** Total clubs for which we resolved *any* logo URL this run. */
  readonly matchedClubCount: number
  readonly matchedLeagueCount: number
  readonly unmatchedClubs: ReadonlyArray<string>
  readonly unmatchedLeagues: ReadonlyArray<string>
  /**
   * How many pending clubs this refresh actually needed to resolve. Non-
   * pending clubs short-circuit the discovery phase entirely. Useful when
   * investigating "nothing loaded" — if this is 0 on a fresh run, ingest
   * already wrote real URLs and the asset refresh is a no-op by design.
   */
  readonly pendingClubCount: number
  /**
   * Per-source counters for logo resolution. `eaCdn` is the primary
   * EA FUT Web App CDN pass (uses clubId directly — no name matching).
   * `sportsdbLeague` is the league-wide discovery fallback,
   * `sportsdbFallback` is the per-club `searchteams.php` rescue, and
   * `wikipedia` is the Wikipedia REST API backstop. Together they sum
   * to `matchedClubCount`.
   */
  readonly matchBreakdown: {
    readonly eaCdn: number
    readonly sportsdbLeague: number
    readonly sportsdbFallback: number
    readonly wikipedia: number
  }
  /**
   * R2 byte-cache counters. `downloaded` = fresh CDN fetch, `alreadyCached`
   * = source URL matched the previous download so the network round-trip
   * was skipped, `failed` = CDN returned non-OK or the body was empty.
   * Logos don't change often, so `alreadyCached` should climb fast on
   * repeat refreshes.
   */
  readonly byteCacheBreakdown: {
    readonly downloaded: number
    readonly alreadyCached: number
    readonly failed: number
  }
}

export interface SquadResetResult {
  readonly status: 'reset' | 'noop'
  readonly deletedVersionCount: number
}

/**
 * Outcome of a one-shot stored-squad repair pass. Rewrites every retained
 * version's `clubs.json` so that leagues which ship with multiple EA
 * `leagueId` values (console vs. handheld variants, regional editions)
 * collapse onto the id with the most clubs in that snapshot. Intended as a
 * migration step after shipping the ingest-side canonicalisation — once run,
 * future ingests stay clean on their own.
 */
export interface SquadRepairResult {
  readonly status: 'repaired' | 'noop'
  /** Total stored squad versions considered. */
  readonly versionCount: number
  /** Versions whose `clubs.json` was rewritten. */
  readonly rewrittenVersionCount: number
  /** Total clubs whose `leagueId` / `leagueName` was rewritten across all versions. */
  readonly rewrittenClubCount: number
  /** Leagues collapsed into a canonical id across all versions (de-duped by raw id). */
  readonly collapsedLeagueCount: number
  /**
   * Duplicate club rows removed from stored squad versions. Triggered
   * when two rows with the same name end up under the same canonical
   * leagueId — typically the console and handheld variants of a
   * licensed club. The canonical row (highest overall rating, lowest id
   * tiebreak) survives; the rest are dropped from `clubs.json` and any
   * matching `players/{collapsedId}.json` shards are merged into the
   * canonical club's shard.
   */
  readonly collapsedClubCount: number
  /**
   * `home_club_id` / `away_club_id` cells in the `games` table that
   * pointed at a collapsed club and were rewritten to the canonical id.
   * Sum of home+away updates so one reassigned game counts at most as
   * two (home changed + away changed).
   */
  readonly rewrittenGameRowCount: number
  /**
   * `game_recorded` event payloads whose embedded `home.clubId` /
   * `away.clubId` were rewritten. Rewriting history is a deliberate
   * architectural exception, scoped to this one-shot migration — see
   * the code comments on `remapClubIdsInPayloads`.
   */
  readonly rewrittenEventPayloadCount: number
}

export interface EaSquadPreviewClub {
  readonly id: number
  readonly name: string
  readonly shortName: string
  readonly leagueName: string
  readonly logoUrl: string
  readonly avatarUrl: string | null
  readonly country: string | null
  readonly foundInSquad: boolean
  readonly matchTerm: string | null
  readonly exactTeamName: string | null
  readonly overallRating: number | null
  readonly attackRating: number | null
  readonly midfieldRating: number | null
  readonly defenseRating: number | null
  readonly matchdayOverallRating: number | null
  readonly matchdayAttackRating: number | null
  readonly matchdayMidfieldRating: number | null
  readonly matchdayDefenseRating: number | null
  readonly starRating: number | null
  readonly ratingDelta: {
    readonly overall: number | null
    readonly attack: number | null
    readonly midfield: number | null
    readonly defense: number | null
  }
}

export interface EaSquadPreviewResponse {
  readonly platform: string
  readonly leagueName: string
  readonly squadVersion: string
  readonly discoveryUrl: string
  readonly squadUrl: string
  readonly fetchedAt: number
  readonly rawBytes: number
  readonly unpackedBytes: number
  readonly matchedClubCount: number
  readonly missingClubNames: ReadonlyArray<string>
  readonly clubs: ReadonlyArray<EaSquadPreviewClub>
}
