// Patterns that indicate a league name belongs to a women's competition.
// Tested before the men's international patterns so women's international
// teams don't get bumped to priority 0.
const WOMENS_LEAGUE_PATTERNS = [
  /\bwomen'?s\b/i,
  /\bwomens\b/i,
  /\bfeminine\b/i,
  /\bfemenina\b/i,
  /\bnwsl\b/i,
]

// Patterns that mark a "league" as non-competitive — EA's specialty
// buckets for historic / classic / legend / icon squads (Zlatan FC,
// classic XIs, hero teams, TOTS/TOTW cards, etc.). These are NOT real
// leagues; they're cosmetic groupings of individual legends and classic
// squads. We detect them so they:
//   1. Never merge with a real domestic league even if normalised names
//      happen to coincide (`canonicaliseLeagueIds`).
//   2. Don't steal a team from its real league when EA ships
//      `leagueTeamLinks` with multiple entries (`mapEaTablesToClubs`).
// Kept as exported helpers so the ingest pipeline and league view can
// agree on the definition.
const NON_COMPETITIVE_LEAGUE_PATTERNS = [
  /\bclassics?\b/i,
  /\blegends?\b/i,
  /\bicons?\b/i,
  /\bheroes?\b/i,
  /\bhistoric(al)?\b/i,
  /\bretro\b/i,
  /\ball[\s-]?stars?\b/i,
  /\bremix\b/i,
  /\btots\b/i,
  /\btotw\b/i,
  /\btoty\b/i,
  /\bteam of the (year|week|season|tournament)\b/i,
  /\bfut\b/i,
  /\bultimate team\b/i,
]

// Patterns that indicate a (men's) international competition. Anything that
// matches one of these — and is NOT also a women's competition — sorts above
// every domestic league.
const MENS_INTERNATIONAL_LEAGUE_PATTERNS = [
  /international/i,
  /national teams?/i,
  /world cup/i,
  /euro(pean)? championship/i,
  /uefa nations league/i,
  /copa america/i,
  /africa(n)? cup/i,
  /men'?s national/i,
]

// User-defined priority order: International (men) first, then the
// user's preferred sequence of domestic tiers, with "Rest of World"
// surfaced as an early default for catch-all ingests. Names are
// normalised (lowercase, punctuation stripped) before comparison so
// EA's seasonal sponsor suffixes — "LaLiga EA Sports", "Serie A
// Enilive", "Ligue 1 McDonalds", etc. — still match. The ordering here
// drives both the sort order of league dropdowns AND which league is
// surfaced first when the user opens a picker, which is why it's
// shaped to put the most-played leagues at the top instead of
// alphabetical.
//
// Each tier is a single regex — where EA ships multiple historical
// names for the same league (Primeira Liga vs. Liga Portugal, Jupiler
// Pro League vs. Belgian Pro League, Süper Lig with or without the
// Trendyol sponsor prefix) the regex uses an alternation so they land
// on the same priority index. Keep these in sync with the test in
// `league-order.test.ts`.
const PRIORITY_LEAGUES = [
  // 1. England — Premier League
  /^premier league$/,
  // 2. Italy — Serie A (any sponsor variant)
  /^serie a\b/,
  // 3. Spain — La Liga (any sponsor variant, with or without space)
  /^la ?liga\b/,
  // 4. Rest of World — EA's catch-all bucket for clubs that don't fit
  //    a real league. Sometimes shipped as "Rest of World", sometimes
  //    "ROW", sometimes "International Clubs" (distinct from national
  //    teams — club-level mixed league, men's only).
  /^rest of (the )?world\b/,
  /^row\b/,
  /^international clubs?\b/,
  // 5. France — Ligue 1 (any sponsor variant)
  /^ligue 1\b/,
  // 6. Germany — Bundesliga top tier (exclude "2. Bundesliga")
  /^bundesliga$/,
  // 7. Belgium — (Jupiler / Belgian) Pro League
  /^(jupiler |belgian )?pro league\b/,
  // 8. Portugal — Primeira Liga / Liga Portugal (either name)
  /^(liga portugal|primeira liga)\b/,
  // 9. Turkey — Süper Lig (optionally prefixed with the Trendyol
  //    sponsor, either 'ü' or 'u' spelling)
  /^(trendyol )?s[uü]per lig\b/,
  // 10. USA — Major League Soccer (full name or MLS acronym)
  /^major league soccer\b/,
  /\bmls\b/,
]

function normalizeLeagueName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9ü]+/g, ' ')
    .trim()
}

function isWomensLeague(rawName: string): boolean {
  return WOMENS_LEAGUE_PATTERNS.some((pattern) => pattern.test(rawName))
}

/**
 * Returns true for EA's non-competitive specialty buckets (Classics,
 * Legends, Icons, Heroes, TOTS/TOTW, FUT Ultimate Team squads). Called
 * by the ingest pipeline to prevent these buckets from absorbing real
 * teams — either via `canonicaliseLeagueIds` merging on a coincidental
 * name match, or via a team's `leagueTeamLinks` pointing at both a real
 * league and a specialty bucket (picking the non-competitive one would
 * misrepresent the team's home league). Accepts the *raw* EA league
 * name — no normalisation required.
 */
export function isNonCompetitiveLeagueName(name: string | null | undefined): boolean {
  if (!name) return false
  return NON_COMPETITIVE_LEAGUE_PATTERNS.some((pattern) => pattern.test(name))
}

export function getLeagueSortPriority(name: string): number {
  if (isWomensLeague(name)) {
    return PRIORITY_LEAGUES.length + 1
  }
  const normalized = normalizeLeagueName(name)
  if (MENS_INTERNATIONAL_LEAGUE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 0
  }

  const priorityIndex = PRIORITY_LEAGUES.findIndex((pattern) => pattern.test(normalized))
  if (priorityIndex >= 0) {
    return priorityIndex + 1
  }

  return PRIORITY_LEAGUES.length + 1
}

export function compareLeagueNames(left: string, right: string): number {
  const leftPriority = getLeagueSortPriority(left)
  const rightPriority = getLeagueSortPriority(right)
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority
  }

  return left.localeCompare(right)
}
