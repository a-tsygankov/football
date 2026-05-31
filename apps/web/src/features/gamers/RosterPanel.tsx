import { useState } from 'react'
import {
  type Gamer,
  NAME_STEM_MIN_LENGTH,
  type RoomBootstrapResponse,
  type UpdateGamerRequest,
  isValidNameStem,
  normalizeNameStem,
} from '@fc26/shared'
import { useDebugConsole } from '../../debug/console-store.js'
import { AvatarPicker } from '../../components/AvatarPicker.jsx'
import { GamerIdentity } from '../../components/GamerPanel.jsx'
import { Field } from '../../components/Field.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { Panel } from '../../components/Panel.jsx'
import {
  compactButtonStyle,
  inputStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'
import { getRosterStatusDot } from '../../utils/roster.js'
import { AddGamerPanel } from './AddGamerPanel.jsx'

export function RosterPanel({
  bootstrap,
  busy,
  activeGameNightGamerIds,
  currentGameGamerIds,
  onToggleGamer,
  onUpdateGamerDetails,
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
  activeGameNightGamerIds: ReadonlySet<string>
  currentGameGamerIds: ReadonlySet<string>
  onToggleGamer: (gamer: Gamer) => Promise<void>
  onUpdateGamerDetails: (gamerId: string, request: UpdateGamerRequest) => Promise<void>
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
  // Add-gamer UI is collapsed by default; the trigger button at the top of
  // the panel expands it on demand and auto-collapses after a successful
  // create so casual gamers don't see the form unless they want it.
  const [addingGamer, setAddingGamer] = useState(false)
  const [editingGamerId, setEditingGamerId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingRating, setEditingRating] = useState('3')
  const [editingAvatarUrl, setEditingAvatarUrl] = useState<string | null>(null)
  const [editingCurrentPin, setEditingCurrentPin] = useState('')
  const [editingNextPin, setEditingNextPin] = useState('')
  // Room admins (anyone who has unlocked the hidden Settings panel via the
  // triple-tap console) can edit PIN-protected gamers without entering the
  // current PIN. The same flag flips the corresponding server-side check
  // in `updateGamer` (see worker/src/routes/rooms.ts).
  const settingsUnlocked = useDebugConsole((s) => s.everOpened)

  function startEditingGamer(gamer: Gamer): void {
    setEditingGamerId(gamer.id)
    setEditingName(gamer.name)
    setEditingRating(String(gamer.rating))
    setEditingAvatarUrl(gamer.avatarUrl)
    setEditingCurrentPin('')
    setEditingNextPin('')
  }

  async function saveGamerDetails(): Promise<void> {
    if (!editingGamerId) return
    const normalized = normalizeNameStem(editingName)
    if (!isValidNameStem(editingName)) return
    if (
      bootstrap.gamers.some(
        (gamer) => gamer.id !== editingGamerId && normalizeNameStem(gamer.name) === normalized,
      )
    ) {
      return
    }
    if (editingCurrentPin.trim().length > 0 && !/^\d{4}$/.test(editingCurrentPin.trim())) {
      return
    }
    if (editingNextPin.trim().length > 0 && !/^\d{4}$/.test(editingNextPin.trim())) {
      return
    }

    await onUpdateGamerDetails(editingGamerId, {
      name: editingName.trim(),
      rating: Number.parseInt(editingRating, 10),
      avatarUrl: editingAvatarUrl,
      currentPin: editingCurrentPin.trim() || null,
      pin: editingNextPin.trim() || null,
      // When Settings is unlocked the admin doesn't need to know the PIN —
      // the server honors `bypassPin` for any room-session caller.
      ...(settingsUnlocked ? { bypassPin: true } : {}),
    })
    setEditingGamerId(null)
    setEditingCurrentPin('')
    setEditingNextPin('')
  }

  // Wrap the create handler so a successful add collapses the form. If the
  // parent throws (validation / collision), the form stays open so the user
  // can adjust their input.
  async function handleCreateGamer(): Promise<void> {
    const beforeCount = bootstrap.gamers.length
    await onCreateGamer()
    // App.tsx clears its `gamerName` state on success — use that as the
    // signal that the create resolved without an error.
    if (bootstrap.gamers.length !== beforeCount || gamerName.trim().length === 0) {
      setAddingGamer(false)
    }
  }

  return (
    <section style={{ marginTop: 18 }}>
      <Panel
        title="Roster"
        subtitle="Dots show who is playing now, who is active but sitting out, and who is inactive."
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setAddingGamer((prev) => !prev)}
              style={addingGamer ? secondaryButtonStyle : primaryButtonStyle}
            >
              {addingGamer ? 'Cancel' : '+ Add gamer'}
            </button>
          </div>
          {addingGamer ? (
            <AddGamerPanel
              bootstrap={bootstrap}
              busy={busy}
              gamerName={gamerName}
              gamerRating={gamerRating}
              gamerPin={gamerPin}
              gamerAvatarUrl={gamerAvatarUrl}
              onChangeGamerName={onChangeGamerName}
              onChangeGamerPin={onChangeGamerPin}
              onChangeGamerRating={onChangeGamerRating}
              onChangeGamerAvatar={onChangeGamerAvatar}
              onCreateGamer={handleCreateGamer}
            />
          ) : null}
          {bootstrap.gamers.length === 0 ? (
            <div
              style={{
                padding: 18,
                borderRadius: 18,
                background: '#f0fdf4',
                border: '1px dashed #86efac',
              }}
            >
              No gamers yet. Add the first one above.
            </div>
          ) : (
            bootstrap.gamers.map((gamer) => {
              const statusDot = getRosterStatusDot({
                gamer,
                activeGameNightGamerIds,
                currentGameGamerIds,
                hasCurrentGame: bootstrap.currentGame !== null,
              })
              return (
                <article
                  key={gamer.id}
                  style={{
                    position: 'relative',
                    borderRadius: 22,
                    padding: 16,
                    background: gamer.active ? '#ffffff' : '#f8fafc',
                    border: `1px solid ${gamer.active ? '#bbf7d0' : '#cbd5e1'}`,
                    boxShadow: '0 8px 24px rgba(5,46,22,0.06)',
                  }}
                >
                  <span
                    aria-label={statusDot.ariaLabel}
                    style={{
                      position: 'absolute',
                      top: 12,
                      right: 12,
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: statusDot.background,
                      border: statusDot.border,
                      boxShadow: statusDot.boxShadow,
                    }}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                    <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                      <GamerIdentity
                        gamer={gamer}
                        size={48}
                        subtitle={`Rating ${gamer.rating} • ${gamer.active ? 'Available' : 'Inactive'}${gamer.hasPin ? ' • PIN' : ''}`}
                        nameStyle={{ fontSize: 18 }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void onToggleGamer(gamer)}
                        style={gamer.active
                          ? { ...secondaryButtonStyle, padding: '8px 12px', fontSize: 13 }
                          : { ...primaryButtonStyle, padding: '8px 12px', fontSize: 13 }}
                      >
                        {busy === 'updating-gamer'
                          ? 'Saving...'
                          : gamer.active
                            ? 'Inactive'
                            : 'Reactivate'}
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          editingGamerId === gamer.id
                            ? setEditingGamerId(null)
                            : startEditingGamer(gamer)
                        }
                        style={compactButtonStyle}
                      >
                        {editingGamerId === gamer.id ? 'Close' : 'Edit'}
                      </button>
                    </div>
                  </div>
                  {editingGamerId === gamer.id ? (
                    <div
                      style={{
                        marginTop: 14,
                        paddingTop: 14,
                        borderTop: '1px solid #dcfce7',
                        display: 'grid',
                        gap: 10,
                      }}
                    >
                      <Field label="Avatar">
                        <AvatarPicker
                          kind="gamer"
                          value={editingAvatarUrl}
                          onChange={setEditingAvatarUrl}
                          disabled={busy !== null}
                        />
                      </Field>
                      <Field label="Name">
                        <input
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          style={inputStyle}
                        />
                      </Field>
                      <Field label="Rating">
                        <select
                          value={editingRating}
                          onChange={(event) => setEditingRating(event.target.value)}
                          style={inputStyle}
                        >
                          {[1, 2, 3, 4, 5].map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {gamer.hasPin && !settingsUnlocked ? (
                        <Field label="Current PIN">
                          <input
                            value={editingCurrentPin}
                            onChange={(event) => setEditingCurrentPin(event.target.value)}
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="Current 4-digit PIN"
                            style={inputStyle}
                          />
                        </Field>
                      ) : null}
                      {gamer.hasPin && settingsUnlocked ? (
                        <InlineNotice
                          tone="info"
                          message="Settings unlocked: this PIN-protected gamer can be edited without entering the current PIN."
                        />
                      ) : null}
                      <Field label={gamer.hasPin ? 'New PIN (leave blank to clear)' : 'Set PIN'}>
                        <input
                          value={editingNextPin}
                          onChange={(event) => setEditingNextPin(event.target.value)}
                          inputMode="numeric"
                          maxLength={4}
                          placeholder={gamer.hasPin ? 'Blank clears PIN' : 'Optional 4-digit PIN'}
                          style={inputStyle}
                        />
                      </Field>
                      {!isValidNameStem(editingName) && editingName.trim().length > 0 ? (
                        <InlineNotice
                          tone="warn"
                          message={`Gamer name must contain at least ${NAME_STEM_MIN_LENGTH} letters or digits.`}
                        />
                      ) : null}
                      {bootstrap.gamers.some(
                        (item) =>
                          item.id !== gamer.id &&
                          normalizeNameStem(item.name) === normalizeNameStem(editingName),
                      ) ? (
                        <InlineNotice tone="warn" message="That gamer name stem is already taken." />
                      ) : null}
                      {editingCurrentPin.trim().length > 0 &&
                      !/^\d{4}$/.test(editingCurrentPin.trim()) ? (
                        <InlineNotice tone="warn" message="Current PIN must be exactly 4 digits." />
                      ) : null}
                      {editingNextPin.trim().length > 0 &&
                      !/^\d{4}$/.test(editingNextPin.trim()) ? (
                        <InlineNotice tone="warn" message="New PIN must be exactly 4 digits." />
                      ) : null}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void saveGamerDetails()}
                          style={primaryButtonStyle}
                        >
                          {busy === 'updating-gamer' ? 'Saving...' : 'Save gamer'}
                        </button>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => setEditingGamerId(null)}
                          style={secondaryButtonStyle}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              )
            })
          )}
        </div>
      </Panel>
    </section>
  )
}
