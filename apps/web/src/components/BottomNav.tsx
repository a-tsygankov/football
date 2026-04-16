import { useEffect, useState } from 'react'
import { useDebugConsole } from '../debug/console-store.js'
import { useTripleTap } from '../debug/use-triple-tap.js'
import { logger } from '../lib/logger.js'

type Mode = 'game' | 'dashboard' | 'teams' | 'changes'

const SECTION_TARGETS: Readonly<Partial<Record<Mode, string>>> = {
  game: 'fc26-game-section',
  dashboard: 'fc26-scoreboard-section',
  teams: 'fc26-teams-section',
  changes: 'fc26-changes-section',
}

const MODES: ReadonlyArray<{ id: Mode; label: string; targetId?: string }> = [
  { id: 'game', label: 'Game', targetId: SECTION_TARGETS.game },
  { id: 'dashboard', label: 'Scoreboard', targetId: SECTION_TARGETS.dashboard },
  { id: 'teams', label: 'Teams', targetId: SECTION_TARGETS.teams },
  { id: 'changes', label: 'Changes', targetId: SECTION_TARGETS.changes },
]

export function BottomNav() {
  const toggleConsole = useDebugConsole((s) => s.toggle)
  const [activeMode, setActiveMode] = useState<Mode | null>(null)
  const onLogoTap = useTripleTap(() => {
    logger.info('system', 'debug console toggled')
    toggleConsole()
  })

  useEffect(() => {
    const enabledModes = MODES.filter((mode) => mode.targetId)
    const anchorOffset = 96

    function updateActiveMode(): void {
      let nextActiveMode: Mode | null = null
      let bestDistance = Number.POSITIVE_INFINITY

      for (const mode of enabledModes) {
        const target = document.getElementById(mode.targetId!)
        if (!target) continue
        const distance = Math.abs(target.getBoundingClientRect().top - anchorOffset)
        if (distance < bestDistance) {
          bestDistance = distance
          nextActiveMode = mode.id
        }
      }

      setActiveMode(nextActiveMode)
    }

    updateActiveMode()
    window.addEventListener('scroll', updateActiveMode, { passive: true })
    window.addEventListener('resize', updateActiveMode)
    return () => {
      window.removeEventListener('scroll', updateActiveMode)
      window.removeEventListener('resize', updateActiveMode)
    }
  }, [])

  function scrollToSection(targetId?: string): void {
    if (!targetId) return
    const target = document.getElementById(targetId)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav
      aria-label="Main navigation"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr auto 1fr 1fr',
        alignItems: 'center',
        height: 64,
        paddingBottom: 'env(safe-area-inset-bottom)',
        background: '#0f172a',
        borderTop: '1px solid #1e293b',
        color: '#e2e8f0',
        zIndex: 10,
      }}
    >
      <ModeButton mode={MODES[0]!} active={activeMode === MODES[0]!.id} onSelect={scrollToSection} />
      <ModeButton mode={MODES[1]!} active={activeMode === MODES[1]!.id} onSelect={scrollToSection} />
      <button
        type="button"
        aria-label="FC26 Team Picker"
        onClick={onLogoTap}
        style={{
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '50%',
          width: 52,
          height: 52,
          color: '#e2e8f0',
          fontWeight: 700,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        FC26
      </button>
      <ModeButton mode={MODES[2]!} active={false} onSelect={scrollToSection} />
      <ModeButton mode={MODES[3]!} active={false} onSelect={scrollToSection} />
    </nav>
  )
}

function ModeButton({
  mode,
  active,
  onSelect,
}: {
  mode: { id: Mode; label: string; targetId?: string }
  active: boolean
  onSelect: (targetId?: string) => void
}) {
  const enabled = Boolean(mode.targetId)
  return (
    <button
      type="button"
      disabled={!enabled}
      aria-disabled={!enabled}
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(mode.targetId)}
      style={{
        background: active ? 'rgba(148,163,184,0.16)' : 'transparent',
        border: active ? '1px solid #475569' : '1px solid transparent',
        borderRadius: 14,
        color: 'inherit',
        fontSize: 13,
        padding: '8px 0',
        cursor: enabled ? 'pointer' : 'default',
        fontWeight: active ? 700 : 500,
        opacity: enabled ? (active ? 1 : 0.7) : 0.35,
        transition: 'background 120ms ease, border-color 120ms ease, opacity 120ms ease',
      }}
    >
      {mode.label}
    </button>
  )
}
