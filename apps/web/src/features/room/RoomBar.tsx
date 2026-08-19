import { GAME_FORMATS, type RoomBootstrapResponse } from '@fc26/shared'
import { Badge } from '@/components/ui/badge'
import type { BusyState } from '../../types/busyState.js'
import type { WorkerVersionInfo } from '../../lib/version.js'
import { RoomDetailSheet } from './RoomDetailSheet.jsx'

/**
 * The whole persistent header, in 56px.
 *
 * It replaces a masthead, three build cards and a dark room panel that
 * together ran to roughly 470px above every single page — about half a phone
 * screen of chrome before any content, repeated on all four tabs. Nothing was
 * dropped: the build numbers, session expiry, room ID and the room actions
 * all live in the detail sheet the room name opens.
 *
 * The old panel's mini-stats doubled as links to Roster and Game. The bottom
 * nav already goes to both, so only the state they carried is kept — as the
 * status pill, which is the one thing that changes while you play.
 */
export function RoomBar({
  bootstrap,
  busy,
  worker,
  workerError,
  installStatus,
  onInstall,
  onLeaveRoom,
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
  onOpenSettings?: (() => void) | undefined
  onRefresh: () => Promise<void>
}) {
  const live = bootstrap.currentGame !== null
  const status = bootstrap.activeGameNight
    ? live
      ? `${GAME_FORMATS[bootstrap.currentGame!.format].label} live`
      : `${bootstrap.activeGameNightGamers.length} ready`
    : 'Not started'

  return (
    <header className="sticky top-0 z-20 -mx-5 mb-4 flex items-center gap-2.5 border-b border-[rgba(5,46,22,0.08)] bg-[rgba(236,253,245,0.86)] px-5 py-2.5 backdrop-blur-md">
      <span
        aria-hidden="true"
        className={`size-2.5 shrink-0 rounded-full ${
          live ? 'bg-[#22c55e] shadow-[0_0_0_4px_rgba(34,197,94,0.14)]' : 'bg-[#bbf7d0]'
        }`}
      />
      {/* A heading and the way in to the detail sheet are the same element:
          the room name is the obvious thing to tap for room things. */}
      <h1 className="m-0 min-w-0 grow truncate text-[17px] font-semibold">
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
      </h1>
      <Badge variant={live ? 'default' : 'outline'} className="shrink-0">
        {status}
      </Badge>
    </header>
  )
}
