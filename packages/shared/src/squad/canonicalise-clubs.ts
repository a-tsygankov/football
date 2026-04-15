import type { Club } from '../types/squad.js'

export interface ClubCanonicalisationResult {
  /** Deduplicated club list, in the original input order (canonical rows kept). */
  readonly clubs: Club[]
  /**
   * Every club id that was removed, mapped to the id of the canonical
   * duplicate that replaced it. Callers feed this into history rewrites:
   *   games.home_club_id, games.away_club_id, game_events payload.clubId.
   * Empty map ⇒ input was already canonical, nothing to rewrite.
   */
  readonly idRemap: ReadonlyMap<number, number>
}

/**
 * Deduplicate club rows that share a real-world identity but ship with
 * multiple EA `id` values.
 *
 * **Why this exists.** The EA roster binary ships separate team rows for
 * console and handheld variants of the same club, and once leagueId
 * canonicalisation merges those variants into one league bucket (see
 * `canonicaliseLeagueIds`) the variants collide: two "Arsenal" rows under
 * leagueId 13, two "AC Milan" rows after the alias pass, etc. Without
 * deduping, the UI renders the same club twice in the league view and
 * randomly picks one when the user draws teams.
 *
 * **Strategy.** Group by `(normalisedName, leagueId)`. Within each group
 * pick the canonical row as the one with the **highest `overallRating`**
 * (the licensed / main entry usually has the cleaner data); ties break on
 * lowest numeric id for determinism. Every non-canonical id becomes an
 * entry in `idRemap` so callers can rewrite historical `clubId` references
 * consistently — important for the one-shot stored-squad repair.
 *
 * This is a pure function: arrays that are already canonical pass through
 * untouched and `idRemap` is empty. Clubs with blank `leagueId`/`name`
 * pass through without grouping so edge cases can't collapse unrelated
 * rows onto each other.
 *
 * **Invariant**: the output's `id` values are a subset of the input's — we
 * never invent new ids. Callers building derived data (player shards,
 * stored games) can rely on that to rewrite references in place.
 */
export function canonicaliseClubs(
  clubs: ReadonlyArray<Club>,
): ClubCanonicalisationResult {
  if (clubs.length === 0) {
    return { clubs: [], idRemap: new Map() }
  }

  interface GroupEntry {
    readonly club: Club
    readonly index: number
  }
  // Bucket every club by its (leagueId, normalisedName) pair. Buckets with
  // a single entry stay untouched; buckets with more than one are where
  // the dedup work happens.
  const groups = new Map<string, GroupEntry[]>()
  for (let i = 0; i < clubs.length; i += 1) {
    const club = clubs[i]!
    const key = groupKey(club)
    if (!key) continue
    const bucket = groups.get(key)
    if (bucket) {
      bucket.push({ club, index: i })
    } else {
      groups.set(key, [{ club, index: i }])
    }
  }

  const idRemap = new Map<number, number>()
  // Set of indices that should be dropped from the output because a
  // sibling in the same bucket was chosen as canonical.
  const dropIndices = new Set<number>()
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue
    // Highest overall wins; ties go to the lowest id so the choice is
    // stable across repeated runs on the same data.
    let winner = bucket[0]!
    for (let i = 1; i < bucket.length; i += 1) {
      const candidate = bucket[i]!
      if (isBetterCanonical(candidate.club, winner.club)) {
        winner = candidate
      }
    }
    for (const entry of bucket) {
      if (entry === winner) continue
      if (entry.club.id === winner.club.id) continue
      idRemap.set(entry.club.id, winner.club.id)
      dropIndices.add(entry.index)
    }
  }

  if (dropIndices.size === 0) {
    return { clubs: [...clubs], idRemap: new Map() }
  }

  const output: Club[] = []
  for (let i = 0; i < clubs.length; i += 1) {
    if (dropIndices.has(i)) continue
    output.push(clubs[i]!)
  }
  return { clubs: output, idRemap }
}

function groupKey(club: Club): string {
  const normalisedName = club.name.trim().replace(/\s+/g, ' ').toLowerCase()
  if (!normalisedName) return ''
  // Keying on both name AND leagueId means "Arsenal" (English Premier
  // League) and "Arsenal de Sarandí" (Argentine Primera) stay separate,
  // and even if a future snapshot has an actual homonym in different
  // leagues we don't accidentally merge them.
  return `${club.leagueId}::${normalisedName}`
}

function isBetterCanonical(candidate: Club, incumbent: Club): boolean {
  if (candidate.overallRating !== incumbent.overallRating) {
    return candidate.overallRating > incumbent.overallRating
  }
  return candidate.id < incumbent.id
}

/**
 * Apply an `idRemap` to a collection of fc players so their `clubId`
 * fields point at canonical club ids. Returns a *new* array only when at
 * least one player needed rewriting — otherwise the caller can skip the
 * R2 write entirely.
 */
export function remapPlayerClubIds<T extends { readonly clubId: number }>(
  players: ReadonlyArray<T>,
  idRemap: ReadonlyMap<number, number>,
): { readonly players: T[]; readonly changed: boolean } {
  if (idRemap.size === 0) {
    return { players: [...players], changed: false }
  }
  let changed = false
  const out: T[] = []
  for (const player of players) {
    const target = idRemap.get(player.clubId)
    if (target === undefined) {
      out.push(player)
    } else {
      changed = true
      out.push({ ...player, clubId: target })
    }
  }
  return { players: out, changed }
}
