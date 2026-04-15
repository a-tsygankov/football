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

export function RosterPanel({
  bootstrap,
  busy,
  activeGameNightGamerIds,
  currentGameGamerIds,
  onToggleGamer,
  onUpdateGamerDetails,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  activeGameNightGamerIds: ReadonlySet<string>
  currentGameGamerIds: ReadonlySet<string>
  onToggleGamer: (gamer: Gamer) => Promise<void>
  onUpdateGamerDetails: (gamerId: string, request: UpdateGamerRequest) => Promise<void>
}) {
  const [editingGamerId, setEditingGamerId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingRating, setEditingRating] = useState('3')
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

  return (
    <section style={{ marginTop: 18 }}>
      <Panel
        title="Roster"
        subtitle="Dots show who is playing now, who is active but sitting out, and who is inactive."
      >
        <div style={{ display: 'grid', gap: 10 }}>
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <GamerIdentity
                      gamer={gamer}
                      size={56}
                      subtitle={`Rating ${gamer.rating} • ${gamer.active ? 'Available' : 'Inactive'}${gamer.hasPin ? ' • PIN protected' : ' • No PIN'}`}
                      nameStyle={{ fontSize: 20 }}
                    />
                    <div style={{ display: 'grid', gap: 8 }}>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void onToggleGamer(gamer)}
                        style={gamer.active ? secondaryButtonStyle : primaryButtonStyle}
                      >
                        {busy === 'updating-gamer'
                          ? 'Saving...'
                          : gamer.active
                            ? 'Set inactive'
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
                        {editingGamerId === gamer.id ? 'Close edit' : 'Edit details'}
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
