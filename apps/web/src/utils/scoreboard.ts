import type { RoomScoreboardResponse } from '@fc26/shared'

export function sortGamerScoreboardRows(
  rows: ReadonlyArray<RoomScoreboardResponse['gamerRows'][number]>,
): ReadonlyArray<RoomScoreboardResponse['gamerRows'][number]> {
  return [...rows].sort(
    (left, right) =>
      right.points - left.points ||
      right.winRate - left.winRate ||
      right.goalDiff - left.goalDiff ||
      right.stats.gamesPlayed - left.stats.gamesPlayed,
  )
}

export function sortTeamScoreboardRows(
  rows: ReadonlyArray<RoomScoreboardResponse['gamerTeamRows'][number]>,
): ReadonlyArray<RoomScoreboardResponse['gamerTeamRows'][number]> {
  return [...rows].sort(
    (left, right) =>
      right.points - left.points ||
      right.winRate - left.winRate ||
      right.goalDiff - left.goalDiff ||
      right.stats.gamesPlayed - left.stats.gamesPlayed,
  )
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatSignedNumber(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}
