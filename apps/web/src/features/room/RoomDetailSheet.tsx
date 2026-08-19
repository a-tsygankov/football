import { formatLocal, type RoomBootstrapResponse } from '@fc26/shared'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import type { BusyState } from '../../types/busyState.js'
import { APP_VERSION, type WorkerVersionInfo } from '../../lib/version.js'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

/**
 * Everything about the room that is not needed while playing.
 *
 * These used to be three version cards and a row of buttons printed above
 * every single page — roughly a third of the screen before any content. None
 * of it changes during a game night, so it lives one tap away instead.
 *
 * The build numbers in particular are diagnostics, not user information: they
 * are here for when something is wrong, and in the debug console otherwise.
 */
export function RoomDetailSheet({
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
  return (
    <Sheet>
      <SheetTrigger asChild>
        {/* The room name is the trigger: it is both the page's heading text
            and the obvious thing to tap for room-level things. */}
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 rounded-sm bg-transparent px-0 text-left text-[17px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{bootstrap.room.name}</span>
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 opacity-45"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span className="sr-only">Room details</span>
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto pb-6">
        <SheetHeader>
          <SheetTitle>{bootstrap.room.name}</SheetTitle>
          <SheetDescription>
            {bootstrap.room.hasPin ? 'PIN protected' : 'Open room'} · everything that does not
            change during a game night.
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-2.5 px-5 py-2">
          <Row label="Room ID" value={bootstrap.room.id} />
          <Row label="Gamers" value={String(bootstrap.gamers.length)} />
          <Row
            label="Session ends"
            value={formatLocal(bootstrap.session.expiresAt, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 px-5 py-3">
          <Button variant="outline" disabled={busy !== null} onClick={() => void onRefresh()}>
            {busy === 'refreshing-room' ? 'Refreshing...' : 'Refresh'}
          </Button>
          {installStatus === 'ready' || installStatus === 'ios' ? (
            <Button variant="outline" onClick={onInstall}>
              Install app
            </Button>
          ) : null}
          {onOpenSettings ? (
            <SheetClose asChild>
              <Button variant="outline" onClick={() => onOpenSettings()}>
                Settings
              </Button>
            </SheetClose>
          ) : null}
          <SheetClose asChild>
            <Button variant="destructive" disabled={busy !== null} onClick={() => onLeaveRoom()}>
              Leave room
            </Button>
          </SheetClose>
        </div>

        <div className="mx-5 mt-1 grid gap-1.5 rounded-md border border-border bg-secondary/60 p-3">
          <p className="m-0 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Build
          </p>
          <Row label="Client" value={APP_VERSION} />
          <Row
            label="Worker"
            value={
              worker
                ? `v${worker.workerVersion} · schema ${worker.schemaVersion}`
                : workerError
                  ? `unreachable: ${workerError}`
                  : 'loading...'
            }
          />
          <Row
            label="Squads"
            value={worker ? (worker.latestSquadVersion ?? 'unseeded') : 'loading...'}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
