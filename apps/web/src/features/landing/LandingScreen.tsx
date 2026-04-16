import type { BusyState } from '../../types/busyState.js'
import { CreateRoomPanel } from './CreateRoomPanel.jsx'
import { JoinRoomPanel } from './JoinRoomPanel.jsx'

export function LandingScreen({
  busy,
  createName,
  createPin,
  joinRoomId,
  joinPin,
  onCreateName,
  onCreatePin,
  onJoinRoomId,
  onJoinPin,
  onCreateRoom,
  onJoinRoom,
}: {
  busy: BusyState
  createName: string
  createPin: string
  joinRoomId: string
  joinPin: string
  onCreateName: (value: string) => void
  onCreatePin: (value: string) => void
  onJoinRoomId: (value: string) => void
  onJoinPin: (value: string) => void
  onCreateRoom: () => Promise<void>
  onJoinRoom: () => Promise<void>
}) {
  return (
    <section
      style={{
        marginTop: 20,
        display: 'grid',
        gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      }}
    >
      <CreateRoomPanel
        busy={busy}
        createName={createName}
        createPin={createPin}
        onCreateName={onCreateName}
        onCreatePin={onCreatePin}
        onCreateRoom={onCreateRoom}
      />
      <JoinRoomPanel
        busy={busy}
        joinRoomId={joinRoomId}
        joinPin={joinPin}
        onJoinRoomId={onJoinRoomId}
        onJoinPin={onJoinPin}
        onJoinRoom={onJoinRoom}
      />
    </section>
  )
}
