import { useDebugConsole } from '../debug/console-store.js'
import { useTripleTap } from '../debug/use-triple-tap.js'
import { logger } from '../lib/logger.js'

/**
 * Always-visible bottom navigation. Holds the four mode tabs and the logo
 * button in the centre. Triple-tapping the logo toggles the debug Console.
 *
 * Mode tabs are inert placeholders at Phase 0 — they render but do not
 * navigate anywhere yet. Phase 2 wires TanStack Router.
 */
type Mode = 'game' | 'dashboard' | 'teams' | 'changes'

const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: 'game', label: 'Game' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'teams', label: 'Teams' },
  { id: 'changes', label: 'Changes' },
]

export function BottomNav() {
  const toggleConsole = useDebugConsole((s) => s.toggle)
  const onLogoTap = useTripleTap(() => {
    logger.info('system', 'debug console toggled')
    toggleConsole()
  })

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
      <ModeButton mode={MODES[0]!} />
      <ModeButton mode={MODES[1]!} />
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
      <ModeButton mode={MODES[2]!} />
      <ModeButton mode={MODES[3]!} />
    </nav>
  )
}

function ModeButton({ mode }: { mode: { id: Mode; label: string } }) {
  return (
    <button
      type="button"
      style={{
        background: 'transparent',
        border: 'none',
        color: 'inherit',
        fontSize: 13,
        padding: '4px 0',
        cursor: 'pointer',
        opacity: 0.7,
      }}
    >
      {mode.label}
    </button>
  )
}
