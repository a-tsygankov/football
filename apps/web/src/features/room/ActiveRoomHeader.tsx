import {
  formatLocal,
  GAME_FORMATS,
  type RoomBootstrapResponse,
} from '@fc26/shared'
import { MiniStat } from '../../components/MiniStat.jsx'
import { secondaryButtonStyle } from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'

export function ActiveRoomHeader({
  bootstrap,
  busy,
  onLeaveRoom,
  onRefresh,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  onLeaveRoom: () => void
  onRefresh: () => Promise<void>
}) {
  return (
    <section
      style={{
        marginTop: 20,
        padding: 22,
        borderRadius: 28,
        background: '#052e16',
        color: '#ecfdf5',
        boxShadow: '0 24px 60px rgba(5,46,22,0.2)',
      }}
    >
      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, opacity: 0.72, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.16em' }}>
            Active room
          </p>
          <h2 style={{ margin: '10px 0 6px', fontSize: 30 }}>{bootstrap.room.name}</h2>
          <p style={{ margin: 0, opacity: 0.78 }}>
            ID: <code>{bootstrap.room.id}</code>
            {bootstrap.room.hasPin ? ' • PIN protected' : ' • Open room'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignSelf: 'flex-start' }}>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onRefresh()}
            style={{
              ...secondaryButtonStyle,
              background: 'rgba(236,253,245,0.12)',
              color: '#ecfdf5',
              borderColor: 'rgba(236,253,245,0.2)',
            }}
          >
            {busy === 'refreshing-room' ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => onLeaveRoom()}
            style={{
              ...secondaryButtonStyle,
              background: 'rgba(254,226,226,0.12)',
              color: '#fecaca',
              borderColor: 'rgba(254,202,202,0.3)',
            }}
          >
            Leave room
          </button>
        </div>
      </div>

      <div
        style={{
          marginTop: 18,
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        <MiniStat label="Gamers" value={String(bootstrap.gamers.length)} />
        <MiniStat
          label="Active game night"
          value={
            bootstrap.activeGameNight
              ? bootstrap.currentGame
                ? `${GAME_FORMATS[bootstrap.currentGame.format].label} live`
                : `${bootstrap.activeGameNightGamers.length} ready`
              : 'Not started'
          }
        />
        <MiniStat
          label="Session"
          value={`until ${formatLocal(bootstrap.session.expiresAt, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}`}
        />
      </div>
    </section>
  )
}
