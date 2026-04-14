const INTERNATIONAL_LEAGUE_PATTERNS = [
  /international/i,
  /national teams?/i,
  /men'?s national/i,
  /women'?s national/i,
  /world cup/i,
]

const PRIORITY_LEAGUES = [
  'premier league',
  'laliga ea sports',
  'bundesliga',
  'serie a enilive',
  'ligue 1 mcdonalds',
  'eredi?visie',
  'liga portugal',
  'major league soccer',
  'mls',
]

function normalizeLeagueName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function getLeagueSortPriority(name: string): number {
  const normalized = normalizeLeagueName(name)
  if (INTERNATIONAL_LEAGUE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 0
  }

  const priorityIndex = PRIORITY_LEAGUES.findIndex((priorityName) => {
    const pattern = new RegExp(`^${priorityName}$`)
    return pattern.test(normalized)
  })

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
