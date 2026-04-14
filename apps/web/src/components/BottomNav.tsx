import { useDebugConsole } from '../debug/console-store.js'
import { useTripleTap } from '../debug/use-triple-tap.js'
import { logger } from '../lib/logger.js'

type Mode = 'game' | 'dashboard' | 'teams' | 'changes'

const SECTION_TARGETS: Readonly<Partial<Record<Mode, string>>> = {
  game: 'fc26-game-section',
  dashboard: 'fc26-scoreboard-section',
}

const MODES: ReadonlyArray<{ id: Mode; label: string; targetId?: string }> = [
  { id: 'game', label: 'Game', targetId: SECTION_TARGETS.game },
  { id: 'dashboard', label: 'Scoreboard', targetId: SECTION_TARGETS.dashboard },
  { id: 'teams', label: 'Teams' },
  { id: 'changes', label: 'Changes' },
]

export function BottomNav() {
  const toggleConsole = useDebugConsole((s) => s.toggle)
  const onLogoTap = useTripleTap(() => {
    logger.info('system', 'debug console toggled')
    toggleConsole()
  })

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
      <ModeButton mode={MODES[0]!} onSelect={scrollToSection} />
      <ModeButton mode={MODES[1]!} onSelect={scrollToSection} />
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
      <ModeButton mode={MODES[2]!} onSelect={scrollToSection} />
      <ModeButton mode={MODES[3]!} onSelect={scrollToSection} />
    </nav>
  )
}

function ModeButton({
  mode,
  onSelect,
}: {
  mode: { id: Mode; label: string; targetId?: string }
  onSelect: (targetId?: string) => void
}) {
  const enabled = Boolean(mode.targetId)
  return (
    <button
      type="button"
      disabled={!enabled}
      aria-disabled={!enabled}
      onClick={() => onSelect(mode.targetId)}
      style={{
        background: 'transparent',
        border: 'none',
        color: 'inherit',
        fontSize: 13,
        padding: '4px 0',
        cursor: enabled ? 'pointer' : 'default',
        opacity: enabled ? 0.7 : 0.35,
      }}
    >
      {mode.label}
    </button>
  )
}
