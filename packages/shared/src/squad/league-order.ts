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

// User-defined priority order: International (men) first, then the highest
// men's tier of each of the listed European nations. Names are normalised
// (lowercase, punctuation stripped) before comparison so EA's seasonal
// sponsor suffixes — "LaLiga EA Sports", "Serie A Enilive", "Ligue 1
// McDonalds" etc. — still match.
const PRIORITY_LEAGUES = [
  // England — Premier League
  /^premier league$/,
  // Spain — La Liga (any sponsor variant)
  /^la ?liga\b/,
  // Italy — Serie A (any sponsor variant)
  /^serie a\b/,
  // France — Ligue 1 (any sponsor variant)
  /^ligue 1\b/,
  // Germany — Bundesliga (top tier only, exclude 2. Bundesliga)
  /^bundesliga$/,
  // Portugal — Liga Portugal / Primeira Liga
  /^liga portugal\b/,
  /^primeira liga\b/,
  // Belgium — (Jupiler) Pro League
  /^jupiler pro league\b/,
  /^belgian pro league\b/,
  /^pro league\b/,
  // Turkey — Süper Lig (any sponsor variant)
  /^s[uü]per lig\b/,
  /^trendyol s[uü]per lig\b/,
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
