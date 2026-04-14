export function deriveTeamStarRating10FromOverall(overallRating: number | null): number | null {
  if (typeof overallRating !== 'number' || Number.isNaN(overallRating)) return null
  if (overallRating <= 1) return 0
  if (overallRating <= 59) return 1
  if (overallRating <= 62) return 2
  if (overallRating <= 64) return 3
  if (overallRating <= 66) return 4
  if (overallRating <= 68) return 5
  if (overallRating <= 70) return 6
  if (overallRating <= 74) return 7
  if (overallRating <= 78) return 8
  if (overallRating <= 82) return 9
  return 10
}

export function resolveEaTeamStarRating10(
  exactStarRating10: number | null,
  overallRating: number | null,
): number | null {
  if (typeof exactStarRating10 === 'number' && !Number.isNaN(exactStarRating10)) {
    return exactStarRating10
  }
  return deriveTeamStarRating10FromOverall(overallRating)
}
