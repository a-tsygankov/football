import type { SquadVersion } from '@fc26/shared'

/**
 * Repository over the `squad_versions` D1 table. Insertions are append-only
 * once a version exists; the `oldestVersionsBeyond` query supports the
 * retention pruner so we can drop the squads beyond the keep-N window.
 */
export interface ISquadVersionRepository {
  insert(version: SquadVersion): Promise<void>
  list(): Promise<ReadonlyArray<SquadVersion>>
  /** Most recently ingested version, or null if the table is empty. */
  latest(): Promise<SquadVersion | null>
  get(version: string): Promise<SquadVersion | null>
  /** Returns versions ordered oldest-first that are beyond the keep-N window. */
  oldestVersionsBeyond(keepCount: number): Promise<ReadonlyArray<SquadVersion>>
  delete(version: string): Promise<void>
}

/**
 * In-memory implementation. Maintains insertion order via the underlying Map
 * but `list()` and `latest()` always re-sort by `ingestedAt` so callers don't
 * have to assume anything about insertion semantics — the production D1
 * implementation also sorts in SQL.
 */
export class InMemorySquadVersionRepository implements ISquadVersionRepository {
  private readonly rows = new Map<string, SquadVersion>()

  async insert(version: SquadVersion): Promise<void> {
    if (this.rows.has(version.version)) {
      throw new Error(`squad version ${version.version} already exists`)
    }
    this.rows.set(version.version, version)
  }

  async list(): Promise<ReadonlyArray<SquadVersion>> {
    return [...this.rows.values()].sort((a, b) => b.ingestedAt - a.ingestedAt)
  }

  async latest(): Promise<SquadVersion | null> {
    const all = await this.list()
    return all[0] ?? null
  }

  async get(version: string): Promise<SquadVersion | null> {
    return this.rows.get(version) ?? null
  }

  async oldestVersionsBeyond(
    keepCount: number,
  ): Promise<ReadonlyArray<SquadVersion>> {
    if (keepCount < 0) throw new Error('keepCount must be >= 0')
    const sortedNewestFirst = await this.list()
    const beyond = sortedNewestFirst.slice(keepCount)
    // Return oldest-first so the pruner deletes in chronological order.
    return [...beyond].reverse()
  }

  async delete(version: string): Promise<void> {
    this.rows.delete(version)
  }
}

/** Maps a D1 row to the domain type. Exported so the D1 implementation reuses it. */
export function rowToSquadVersion(row: SquadVersionRow): SquadVersion {
  return {
    version: row.version,
    releasedAt: row.released_at,
    ingestedAt: row.ingested_at,
    clubsBytes: row.clubs_bytes,
    clubCount: row.club_count,
    playerCount: row.player_count,
    sourceUrl: row.source_url,
    notes: row.notes,
  }
}

interface SquadVersionRow {
  version: string
  released_at: number | null
  ingested_at: number
  clubs_bytes: number
  club_count: number
  player_count: number
  source_url: string
  notes: string | null
}

/**
 * D1-backed implementation. Uses prepared statements throughout so the
 * Worker doesn't pay the parse cost on every call.
 */
export class D1SquadVersionRepository implements ISquadVersionRepository {
  constructor(private readonly db: D1Database) {}

  async insert(version: SquadVersion): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO squad_versions
           (version, released_at, ingested_at, clubs_bytes, club_count, player_count, source_url, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        version.version,
        version.releasedAt,
        version.ingestedAt,
        version.clubsBytes,
        version.clubCount,
        version.playerCount,
        version.sourceUrl,
        version.notes,
      )
      .run()
  }

  async list(): Promise<ReadonlyArray<SquadVersion>> {
    const result = await this.db
      .prepare(
        `SELECT * FROM squad_versions ORDER BY ingested_at DESC, version DESC`,
      )
      .all<SquadVersionRow>()
    return (result.results ?? []).map(rowToSquadVersion)
  }

  async latest(): Promise<SquadVersion | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM squad_versions ORDER BY ingested_at DESC, version DESC LIMIT 1`,
      )
      .first<SquadVersionRow>()
    return row ? rowToSquadVersion(row) : null
  }

  async get(version: string): Promise<SquadVersion | null> {
    const row = await this.db
      .prepare(`SELECT * FROM squad_versions WHERE version = ?`)
      .bind(version)
      .first<SquadVersionRow>()
    return row ? rowToSquadVersion(row) : null
  }

  async oldestVersionsBeyond(
    keepCount: number,
  ): Promise<ReadonlyArray<SquadVersion>> {
    if (keepCount < 0) throw new Error('keepCount must be >= 0')
    // Negative limit is invalid; -1 in OFFSET means "all" in SQLite when paired with LIMIT -1.
    const result = await this.db
      .prepare(
        `SELECT * FROM squad_versions
         ORDER BY ingested_at ASC, version ASC
         LIMIT -1 OFFSET 0`,
      )
      .all<SquadVersionRow>()
    const all = (result.results ?? []).map(rowToSquadVersion)
    // The total count tells us how many to drop. Computing in JS is fine —
    // squad_versions never holds more than ~12 rows after retention pruning.
    if (all.length <= keepCount) return []
    return all.slice(0, all.length - keepCount)
  }

  async delete(version: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM squad_versions WHERE version = ?`)
      .bind(version)
      .run()
  }
}
