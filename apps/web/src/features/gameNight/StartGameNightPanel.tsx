import { useState } from 'react'
import { DEFAULT_BUY_IN } from '@fc26/shared'
import { Field } from '../../components/Field.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { Panel } from '../../components/Panel.jsx'
import { inputStyle, primaryButtonStyle } from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'

/**
 * Starts a game night.
 *
 * Only rendered when there is no active night — `RoomScreen` swaps in
 * `GameCreationPanel` the moment one exists. This used to carry a second
 * branch describing a live night, which nothing could reach.
 */
export function StartGameNightPanel({
  busy,
  onStartGameNight,
}: {
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
      title="Start game night"
      subtitle="This uses the currently active gamers in the room."
    >
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
    </Panel>
  )
}
