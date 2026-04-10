import { GamerTeamKey, type GamerId } from './ids.js'

/**
 * Stable key for an ad-hoc gamer pairing. {Alice, Bob} and {Bob, Alice}
 * collapse to the same key so the projection naturally aggregates across
 * games regardless of which side they were on or what order they were listed.
 */
export function gamerTeamKey(gamerIds: readonly GamerId[]): GamerTeamKey {
  if (gamerIds.length === 0) {
    throw new Error('gamerTeamKey requires at least one gamer ID')
  }
  const sorted = [...gamerIds].sort()
  return GamerTeamKey(`gt_${sorted.join('_')}`)
}
