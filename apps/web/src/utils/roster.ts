import type { CurrentGame, Gamer } from '@fc26/shared'

export function buildManualAssignments(
  currentGame: CurrentGame | null,
): Record<string, 'home' | 'away' | 'bench'> {
  if (!currentGame) return {}
  const next: Record<string, 'home' | 'away' | 'bench'> = {}
  for (const gamerId of currentGame.homeGamerIds) next[gamerId] = 'home'
  for (const gamerId of currentGame.awayGamerIds) next[gamerId] = 'away'
  return next
}

export interface RosterStatusDot {
  ariaLabel: string
  background: string
  border: string
  boxShadow: string
}

export function getRosterStatusDot({
  gamer,
  activeGameNightGamerIds,
  currentGameGamerIds,
  hasCurrentGame,
}: {
  gamer: Gamer
  activeGameNightGamerIds: ReadonlySet<string>
  currentGameGamerIds: ReadonlySet<string>
  hasCurrentGame: boolean
}): RosterStatusDot {
  if (hasCurrentGame) {
    if (currentGameGamerIds.has(gamer.id)) {
      return {
        ariaLabel: `${gamer.name} is playing in the current game`,
        background: '#22c55e',
        border: '1px solid #16a34a',
        boxShadow: '0 0 0 4px rgba(34,197,94,0.14)',
      }
    }
    if (gamer.active) {
      return {
        ariaLabel: `${gamer.name} is active but sitting out the current game`,
        background: '#cbd5e1',
        border: '1px solid #94a3b8',
        boxShadow: '0 0 0 4px rgba(148,163,184,0.16)',
      }
    }
    return {
      ariaLabel: `${gamer.name} is inactive`,
      background: '#ffffff',
      border: '1px solid #cbd5e1',
      boxShadow: '0 0 0 4px rgba(203,213,225,0.16)',
    }
  }

  if (activeGameNightGamerIds.has(gamer.id)) {
    return {
      ariaLabel: `${gamer.name} is active in the live pool`,
      background: '#cbd5e1',
      border: '1px solid #94a3b8',
      boxShadow: '0 0 0 4px rgba(148,163,184,0.16)',
    }
  }

  return {
    ariaLabel: gamer.active ? `${gamer.name} is active` : `${gamer.name} is inactive`,
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    boxShadow: '0 0 0 4px rgba(203,213,225,0.16)',
  }
}

