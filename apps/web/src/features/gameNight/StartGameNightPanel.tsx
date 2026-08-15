import { useState } from 'react'
import {
  DEFAULT_BUY_IN,
  formatRelative,
  GAME_FORMATS,
  type RoomBootstrapResponse,
} from '@fc26/shared'
import { Field } from '../../components/Field.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { Panel } from '../../components/Panel.jsx'
import { inputStyle, primaryButtonStyle } from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'

export function StartGameNightPanel({
  bootstrap,
  busy,
  onStartGameNight,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  onStartGameNight: (buyIn: number) => Promise<void>
}) {
  const [buyIn, setBuyIn] = useState(String(DEFAULT_BUY_IN))
  const [error, setError] = useState<string | null>(null)

  function start(): void {
    const parsed = Number.parseInt(buyIn.trim(), 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError('Buy-in must be at least 1 chip.')
      return
    }
    setError(null)
    void onStartGameNight(parsed)
  }

  return (
    <Panel
      title={bootstrap.activeGameNight ? 'Game night live' : 'Start game night'}
      subtitle={
        bootstrap.activeGameNight
          ? `Started ${formatRelative(bootstrap.activeGameNight.startedAt)}`
          : 'This uses the currently active gamers in the room.'
      }
    >
      {bootstrap.activeGameNight ? (
        <div
          style={{
            padding: 14,
            borderRadius: 18,
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
          }}
        >
          <strong>
            {bootstrap.currentGame
              ? `${GAME_FORMATS[bootstrap.currentGame.format].label} currently on`
              : `${bootstrap.activeGameNightGamers.length} gamers in the live pool`}
          </strong>
          <p style={{ margin: '8px 0 0', fontSize: 14, opacity: 0.75 }}>
            Everyone bought in for {bootstrap.activeGameNight.buyIn} chips.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {/* Fixed for the whole night once it starts, so it is asked for here
              rather than being editable later. */}
          <Field label="Buy-in per gamer">
            <input
              value={buyIn}
              onChange={(event) => setBuyIn(event.target.value)}
              inputMode="numeric"
              placeholder="Chips"
              style={inputStyle}
            />
          </Field>

          {error ? <InlineNotice tone="warn" message={error} /> : null}

          <button
            type="button"
            disabled={busy !== null}
            onClick={start}
            style={primaryButtonStyle}
          >
            {busy === 'starting-game-night' ? 'Starting...' : 'Start game night'}
          </button>
        </div>
      )}
    </Panel>
  )
}
