import {
  formatLocal,
  GAME_FORMATS,
  type RoomBootstrapResponse,
} from '@fc26/shared'
import { MiniStat } from '../../components/MiniStat.jsx'
import type { BusyState } from '../../types/busyState.js'
import type { WorkerVersionInfo } from '../../lib/version.js'
import { RoomDetailSheet } from './RoomDetailSheet.jsx'

export function ActiveRoomHeader({
  bootstrap,
  busy,
  worker,
  workerError,
  installStatus,
  onInstall,
  onLeaveRoom,
  onOpenGamePanel,
  onOpenRoster,
  onOpenSettings,
  onRefresh,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  worker: WorkerVersionInfo | null
  workerError: string | null
  installStatus: string
  onInstall: () => void
  onLeaveRoom: () => void
  onOpenGamePanel: () => void
  onOpenRoster: () => void
  /**
   * Shown only once Settings is unlocked. With each tab now a page and no nav
   * slot for Settings, unlocking it used to leave it unreachable except by
   * typing the hash — this is the way in.
   */
  onOpenSettings?: () => void
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
        <div style={{ alignSelf: 'flex-start' }}>
          <RoomDetailSheet
            bootstrap={bootstrap}
            busy={busy}
            worker={worker}
            workerError={workerError}
            installStatus={installStatus}
            onInstall={onInstall}
            onLeaveRoom={onLeaveRoom}
            onOpenSettings={onOpenSettings}
            onRefresh={onRefresh}
          />
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
        <MiniStat label="Gamers" value={String(bootstrap.gamers.length)} onClick={onOpenRoster} />
        <MiniStat
          label="Active game night"
          value={
            bootstrap.activeGameNight
              ? bootstrap.currentGame
                ? `${GAME_FORMATS[bootstrap.currentGame.format].label} live`
                : `${bootstrap.activeGameNightGamers.length} ready`
              : 'Not started'
          }
          onClick={onOpenGamePanel}
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
