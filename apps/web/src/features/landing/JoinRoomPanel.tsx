import { Field } from '../../components/Field.jsx'
import { Panel } from '../../components/Panel.jsx'
import { inputStyle, secondaryButtonStyle } from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'

export function JoinRoomPanel({
  busy,
  joinRoomId,
  joinPin,
  onJoinRoomId,
  onJoinPin,
  onJoinRoom,
}: {
  busy: BusyState
  joinRoomId: string
  joinPin: string
  onJoinRoomId: (value: string) => void
  onJoinPin: (value: string) => void
  onJoinRoom: () => Promise<void>
}) {
  return (
    <Panel title="Join room" subtitle="Re-enter by room id, room name, and optional PIN.">
      <Field label="Room id or room name">
        <input
          value={joinRoomId}
          onChange={(event) => onJoinRoomId(event.target.value)}
          placeholder="Paste room id or type room name"
          style={inputStyle}
        />
      </Field>
      <Field label="PIN">
        <input
          value={joinPin}
          onChange={(event) => onJoinPin(event.target.value)}
          placeholder="4 digits if needed"
          inputMode="numeric"
          maxLength={4}
          style={inputStyle}
        />
      </Field>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void onJoinRoom()}
        style={secondaryButtonStyle}
      >
        {busy === 'joining-room' ? 'Joining...' : 'Join room'}
      </button>
    </Panel>
  )
}
