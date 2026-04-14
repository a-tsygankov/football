import {
  type RoomBootstrapResponse,
  isValidNameStem,
  normalizeNameStem,
} from '@fc26/shared'
import { AvatarPicker } from '../../components/AvatarPicker.jsx'
import { Field } from '../../components/Field.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { Panel } from '../../components/Panel.jsx'
import { inputStyle, secondaryButtonStyle } from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'

export function AddGamerPanel({
  bootstrap,
  busy,
  gamerName,
  gamerRating,
  gamerPin,
  gamerAvatarUrl,
  onChangeGamerName,
  onChangeGamerPin,
  onChangeGamerRating,
  onChangeGamerAvatar,
  onCreateGamer,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  gamerName: string
  gamerRating: string
  gamerPin: string
  gamerAvatarUrl: string | null
  onChangeGamerName: (value: string) => void
  onChangeGamerPin: (value: string) => void
  onChangeGamerRating: (value: string) => void
  onChangeGamerAvatar: (value: string | null) => void
  onCreateGamer: () => Promise<void>
}) {
  const gamerNameStem = normalizeNameStem(gamerName)
  const gamerNameTakenLocally = bootstrap.gamers.some(
    (gamer) => normalizeNameStem(gamer.name) === gamerNameStem,
  )
  const canCreateGamer =
    gamerName.trim().length > 0 &&
    isValidNameStem(gamerName) &&
    !gamerNameTakenLocally &&
    (gamerPin.trim().length === 0 || /^\d{4}$/.test(gamerPin.trim()))

  return (
    <Panel title="Add gamer" subtitle="New gamers appear in the room roster immediately.">
      <Field label="Avatar">
        <AvatarPicker
          kind="gamer"
          value={gamerAvatarUrl}
          onChange={onChangeGamerAvatar}
          disabled={busy !== null}
        />
      </Field>
      <Field label="Name">
        <input
          value={gamerName}
          onChange={(event) => onChangeGamerName(event.target.value)}
          placeholder="Alice"
          style={inputStyle}
        />
      </Field>
      <Field label="Rating">
        <select
          value={gamerRating}
          onChange={(event) => onChangeGamerRating(event.target.value)}
          style={inputStyle}
        >
          {[1, 2, 3, 4, 5].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Optional edit PIN">
        <input
          value={gamerPin}
          onChange={(event) => onChangeGamerPin(event.target.value)}
          placeholder="4 digits"
          inputMode="numeric"
          maxLength={4}
          style={inputStyle}
        />
      </Field>
      <p style={{ margin: '0 0 12px', fontSize: 13, opacity: 0.7 }}>
        Names compare by stem: case, spaces, and punctuation are ignored.
      </p>
      {!isValidNameStem(gamerName) && gamerName.trim().length > 0 ? (
        <InlineNotice tone="warn" message="Enter at least one letter or digit in the gamer name." />
      ) : null}
      {gamerNameTakenLocally ? (
        <InlineNotice tone="warn" message="That gamer name stem already exists in this room." />
      ) : null}
      {gamerPin.trim().length > 0 && !/^\d{4}$/.test(gamerPin.trim()) ? (
        <InlineNotice tone="warn" message="Gamer PIN must be exactly 4 digits." />
      ) : null}
      <button
        type="button"
        disabled={busy !== null || !canCreateGamer}
        onClick={() => void onCreateGamer()}
        style={secondaryButtonStyle}
      >
        {busy === 'creating-gamer' ? 'Adding...' : 'Add gamer'}
      </button>
    </Panel>
  )
}
