import {
  formatRelative,
  GAME_FORMATS,
  type RoomBootstrapResponse,
} from '@fc26/shared'
import { Panel } from '../../components/Panel.jsx'
import { primaryButtonStyle } from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'

export function StartGameNightPanel({
  bootstrap,
  busy,
  onStartGameNight,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  onStartGameNight: () => Promise<void>
}) {
  return (
    <Panel
      title={bootstrap.activeGameNight ? 'Game night live' : 'Start game night'}
      subtitle={
        bootstrap.activeGameNight
          ? `Started ${formatRelative(bootstrap.activeGameNight.startedAt)}`
          : 'This uses the currently active gamers in the room.'
      }
    >
      {bootstrap.activeGameNight ? (
        <div
          style={{
            padding: 14,
            borderRadius: 18,
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
          }}
        >
          <strong>
            {bootstrap.currentGame
              ? `${GAME_FORMATS[bootstrap.currentGame.format].label} currently on`
              : `${bootstrap.activeGameNightGamers.length} gamers in the live pool`}
          </strong>
          <p style={{ margin: '8px 0 0', fontSize: 14, opacity: 0.75 }}>
            Re-entry can now forward straight into the active room context.
          </p>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void onStartGameNight()}
          style={primaryButtonStyle}
        >
          {busy === 'starting-game-night' ? 'Starting...' : 'Start game night'}
        </button>
      )}
    </Panel>
  )
}
