import { isValidNameStem } from '@fc26/shared'
import { Field } from '../../components/Field.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { Panel } from '../../components/Panel.jsx'
import { inputStyle, primaryButtonStyle } from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'

export function CreateRoomPanel({
  busy,
  createName,
  createPin,
  onCreateName,
  onCreatePin,
  onCreateRoom,
}: {
  busy: BusyState
  createName: string
  createPin: string
  onCreateName: (value: string) => void
  onCreatePin: (value: string) => void
  onCreateRoom: () => Promise<void>
}) {
  const createRoomNameValid = isValidNameStem(createName)
  const createRoomPinValid = createPin.trim().length === 0 || /^\d{4}$/.test(createPin.trim())

  return (
    <Panel title="Create room" subtitle="Spin up a fresh room and land inside it immediately.">
      <Field label="Room name">
        <input
          value={createName}
          onChange={(event) => onCreateName(event.target.value)}
          placeholder="Friday FC"
          style={inputStyle}
        />
      </Field>
      <Field label="Optional PIN">
        <input
          value={createPin}
          onChange={(event) => onCreatePin(event.target.value)}
          placeholder="4 digits"
          inputMode="numeric"
          maxLength={4}
          style={inputStyle}
        />
      </Field>
      <p style={{ margin: '0 0 12px', fontSize: 13, opacity: 0.7 }}>
        Room names compare by stem: case, spaces, and punctuation are ignored.
      </p>
      {!createRoomNameValid && createName.trim().length > 0 ? (
        <InlineNotice tone="warn" message="Enter at least one letter or digit in the room name." />
      ) : null}
      {!createRoomPinValid ? (
        <InlineNotice tone="warn" message="Room PIN must be exactly 4 digits." />
      ) : null}
      <button
        type="button"
        disabled={busy !== null || !createRoomNameValid || !createRoomPinValid || !createName.trim()}
        onClick={() => void onCreateRoom()}
        style={primaryButtonStyle}
      >
        {busy === 'creating-room' ? 'Creating room...' : 'Create room'}
      </button>
    </Panel>
  )
}
