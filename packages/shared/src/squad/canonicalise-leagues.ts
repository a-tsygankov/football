import type { Club } from '../types/squad.js'
import { isNonCompetitiveLeagueName } from './league-order.js'

// Upper bound on plausible domestic-league club counts. Real top-tier
// leagues sit in the 18-24 range (Bundesliga 18, Ligue 1 18, Premier
// League 20, Serie A 20, La Liga 20, MLS 30). If merging two same-named
// buckets would push the canonical past this threshold, we assume the
// buckets are actually different real-world competitions that coincide
// in name (e.g. a specialty "Premier League Classics" bucket that EA
// spelled identically to the real Premier League), and we refuse the
// merge. 40 is intentionally generous so the MLS-sized outlier still
// fits even when EA ships a 2-id console/handheld variant.
const MAX_MERGED_LEAGUE_SIZE = 40

/**
 * Deduplicate leagues that share the same human name but ship with multiple
 * EA `leagueId` values.
 *
 * **Why this exists.** The EA roster binary exposes leagues keyed by a
 * numeric id, and for historical / platform reasons the same real-world
 * competition can appear under 3-4 different ids in a single snapshot
 * (console vs. handheld variants, regional tournament editions, …). Our
 * league view (`deriveLeagues` in the worker) groups strictly by
 * `leagueId`, so those variants render as separate tiles in the UI.
 *
 * **Strategy.** Group clubs by a normalised league-name key (trim, collapse
 * whitespace, lowercase). For each group, pick the canonical `leagueId` =
 * **the id that owns the most clubs in this snapshot**. Ties break on the
 * lowest numeric id for determinism. Rewrite every club in the group so
 * `leagueId` and `leagueName` match the canonical id's representative.
 *
 * This is a pure function: clubs that are already canonical (single id per
 * name) pass through untouched. Name-less buckets (empty `leagueName`) are
 * also passed through, because normalising the empty string would collapse
 * them together with every other empty-name league in some hypothetical
 * future snapshot.
 */
export function canonicaliseLeagueIds(clubs: ReadonlyArray<Club>): Club[] {
  if (clubs.length === 0) return []

  // First pass: bucket clubs by normalised league name, counting
  // occurrences per raw leagueId inside each bucket. We also remember the
  // first non-empty `leagueName` string seen for each (bucket, leagueId)
  // pair so the rewrite can keep whichever EA spelling appeared the most.
  interface LeagueBucket {
    readonly countsById: Map<number, number>
    readonly nameByLeagueId: Map<number, string>
    // Whether the raw league name for this id matches EA's
    // non-competitive "specialty" bucket patterns (Classic/Legends/
    // Icons/Heroes/TOTS/…). Tracked per leagueId so that when two
    // same-name buckets exist — one real league, one specialty —
    // we refuse to merge across the boundary.
    readonly nonCompetitiveByLeagueId: Map<number, boolean>
  }
  const bucketByName = new Map<string, LeagueBucket>()
  for (const club of clubs) {
    const key = normaliseLeagueKey(club.leagueName)
    if (!key) continue
    let bucket = bucketByName.get(key)
    if (!bucket) {
      bucket = {
        countsById: new Map(),
        nameByLeagueId: new Map(),
        nonCompetitiveByLeagueId: new Map(),
      }
      bucketByName.set(key, bucket)
    }
    bucket.countsById.set(club.leagueId, (bucket.countsById.get(club.leagueId) ?? 0) + 1)
    if (!bucket.nameByLeagueId.has(club.leagueId)) {
      bucket.nameByLeagueId.set(club.leagueId, club.leagueName)
      bucket.nonCompetitiveByLeagueId.set(
        club.leagueId,
        isNonCompetitiveLeagueName(club.leagueName),
      )
    }
  }

  // Second pass: compute, per name-bucket, the canonical leagueId. Then
  // build a map from every raw leagueId → canonical target so the rewrite
  // loop is O(clubs).
  const canonicalById = new Map<
    number,
    { readonly leagueId: number; readonly leagueName: string }
  >()
  for (const bucket of bucketByName.values()) {
    if (bucket.countsById.size <= 1) {
      // Already canonical — skip so we don't needlessly rebuild the club.
      continue
    }
    // Refuse to merge across the "specialty / real league" boundary.
    // If EA ships a "Premier League Classics" bucket whose name
    // happens to normalise to "premier league" (or some future
    // spelling we can't predict), we must not fold its classic
    // squads into the real Premier League roster.
    const nonCompetitiveFlags = new Set(bucket.nonCompetitiveByLeagueId.values())
    if (nonCompetitiveFlags.size > 1) {
      continue
    }
    // Sanity cap: if the merged total would exceed any plausible
    // real-league size (see MAX_MERGED_LEAGUE_SIZE), the two same-
    // named buckets are almost certainly different competitions
    // that happen to share a spelling. Leave them separate.
    let totalCount = 0
    for (const count of bucket.countsById.values()) totalCount += count
    if (totalCount > MAX_MERGED_LEAGUE_SIZE) {
      continue
    }
    let canonicalLeagueId: number | null = null
    let bestCount = -1
    for (const [leagueId, count] of bucket.countsById) {
      if (
        count > bestCount ||
        (count === bestCount && canonicalLeagueId !== null && leagueId < canonicalLeagueId)
      ) {
        canonicalLeagueId = leagueId
        bestCount = count
      }
    }
    if (canonicalLeagueId === null) continue
    const canonicalName =
      bucket.nameByLeagueId.get(canonicalLeagueId) ?? [...bucket.nameByLeagueId.values()][0] ?? ''
    for (const leagueId of bucket.countsById.keys()) {
      if (leagueId === canonicalLeagueId) continue
      canonicalById.set(leagueId, { leagueId: canonicalLeagueId, leagueName: canonicalName })
    }
  }

  if (canonicalById.size === 0) return [...clubs]

  return clubs.map((club) => {
    const target = canonicalById.get(club.leagueId)
    if (!target) return club
    return {
      ...club,
      leagueId: target.leagueId,
      leagueName: target.leagueName,
    }
  })
}

/**
 * Produce the bucket key used to detect "the same league under different
 * ids". Intentionally conservative: trim, collapse internal whitespace,
 * lowercase. We do NOT strip "English" or expand "EPL" — if two leagues
 * differ only by a prefix word, they're probably actually different leagues
 * (English Premier League vs. Premier League of India, etc.) and the
 * caller can extend this later with evidence. Returns the empty string for
 * null/blank inputs so those clubs are passed through untouched.
 */
function normaliseLeagueKey(leagueName: string | null | undefined): string {
  if (!leagueName) return ''
  return leagueName.trim().replace(/\s+/g, ' ').toLowerCase()
}

export const __TEST_ONLY__ = { normaliseLeagueKey }
