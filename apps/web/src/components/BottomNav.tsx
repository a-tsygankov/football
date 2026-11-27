import { useDebugConsole } from '../debug/console-store.js'
import { useTripleTap } from '../debug/use-triple-tap.js'
import { logger } from '../lib/logger.js'
import type { Route } from '../hooks/useHashRoute.js'

/**
 * The four tabs, in bar order. Teams gave up its slot to Wager; it is still
 * reachable at #/teams (the Game page links there when picking FC clubs)
 * because the squad browser remains the only way to look up club ratings.
 */
const MODES: ReadonlyArray<{ id: Route; label: string }> = [
  { id: 'game', label: 'Game' },
  { id: 'scoreboard', label: 'Scoreboard' },
  { id: 'wager', label: 'Wager' },
  { id: 'roster', label: 'Roster' },
]

/**
 * Roster is off the bar, not gone: the page, its route (#/roster) and its
 * styles are untouched, and the Game page's Players panel covers adding and
 * editing gamers meanwhile. Set this to true to bring the tab straight back.
 */
const SHOW_ROSTER_TAB: boolean = false

const TABS = MODES.filter((mode) => SHOW_ROSTER_TAB || mode.id !== 'roster')
// The logo sits in the middle of an even number of tabs, and at the end of an
// odd number, where a middle would leave the bar lopsided.
const LOGO_INDEX = TABS.length % 2 === 0 ? TABS.length / 2 : TABS.length

/**
 * Bottom navigation.
 *
 * Previously these were scroll anchors into one long page, and the active tab
 * was inferred by measuring which section sat nearest the top of the viewport.
 * Now each tab is a real page, so the active state is simply the current route
 * — no scroll listener, no measuring, and no ambiguity when two sections were
 * visible at once.
 */
export function BottomNav({
  route,
  onNavigate,
}: {
  route: Route
  onNavigate: (route: Route) => void
}) {
  const toggleConsole = useDebugConsole((s) => s.toggle)
  const onLogoTap = useTripleTap(() => {
    logger.info('system', 'debug console toggled')
    toggleConsole()
  })

  const tabs = TABS.map((mode) => (
    <ModeButton key={mode.id} mode={mode} active={route === mode.id} onSelect={onNavigate} />
  ))
  const columns = TABS.map(() => '1fr')
  columns.splice(LOGO_INDEX, 0, 'auto')

  return (
    <nav
      aria-label="Main navigation"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        display: 'grid',
        gridTemplateColumns: columns.join(' '),
        alignItems: 'center',
        height: 64,
        paddingBottom: 'env(safe-area-inset-bottom)',
        background: '#0f172a',
        borderTop: '1px solid #1e293b',
        color: '#e2e8f0',
        zIndex: 10,
      }}
    >
      {tabs.slice(0, LOGO_INDEX)}
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
          marginInline: 8,
        }}
      >
        FC26
      </button>
      {tabs.slice(LOGO_INDEX)}
    </nav>
  )
}

function ModeButton({
  mode,
  active,
  onSelect,
}: {
  mode: { id: Route; label: string }
  active: boolean
  onSelect: (route: Route) => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(mode.id)}
      style={{
        background: active ? 'rgba(148,163,184,0.16)' : 'transparent',
        border: active ? '1px solid #475569' : '1px solid transparent',
        borderRadius: 14,
        color: 'inherit',
        fontSize: 13,
        padding: '8px 0',
        cursor: 'pointer',
        fontWeight: active ? 700 : 500,
        opacity: active ? 1 : 0.7,
        transition: 'background 120ms ease, border-color 120ms ease, opacity 120ms ease',
      }}
    >
      {mode.label}
    </button>
  )
}
