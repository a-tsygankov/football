import { useState } from 'react'
import {
  type ChipLedgerResponse,
  DEFAULT_BUY_IN,
  type Gamer,
  type GamerId,
} from '@fc26/shared'
import { Field } from '../../components/Field.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { Panel } from '../../components/Panel.jsx'
import { inputStyle, primaryButtonStyle } from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function toneOf(value: number): string {
  return value > 0 ? '#15803d' : value < 0 ? '#b91c1c' : '#475569'
}

/**
 * The room's chip ledger and what it would take to settle up.
 *
 * Balances are room-wide and carry across nights, so this is the running
 * account rather than a scoreboard for tonight — `ChipStandingsPanel` still
 * covers the evening's swing.
 */
export function ChipLedgerPanel({
  busy,
  gamers,
  ledger,
  onBuyChips,
}: {
  busy: BusyState
  gamers: ReadonlyArray<Gamer>
  ledger: ChipLedgerResponse | null
  onBuyChips: (gamerId: GamerId, amount: number) => Promise<void>
}) {
  const [buyerId, setBuyerId] = useState<GamerId | ''>('')
  const [amount, setAmount] = useState(String(DEFAULT_BUY_IN))
  const [error, setError] = useState<string | null>(null)

  function nameOf(gamerId: string): string {
    return gamers.find((gamer) => gamer.id === gamerId)?.name ?? 'Unknown'
  }

  function buy(): void {
    if (buyerId === '') {
      setError('Pick who is buying.')
      return
    }
    const parsed = Number.parseInt(amount.trim(), 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError('Buy at least 1 chip.')
      return
    }
    setError(null)
    void onBuyChips(buyerId, parsed)
  }

  const entries = ledger?.entries ?? []
  const transfers = ledger?.transfers ?? []

  return (
    <Panel
      title="Chips"
      subtitle="Balances carry between nights. Buy more whenever you run dry."
    >
      <div style={{ display: 'grid', gap: 14 }}>
        {entries.length === 0 ? (
          <InlineNotice tone="info" message="Nobody has bought chips in this room yet." />
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
            {entries.map((entry) => (
              <li
                key={entry.gamerId}
                style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 14 }}
              >
                <span style={{ flex: 1 }}>{nameOf(entry.gamerId)}</span>
                {entry.committed > 0 ? (
                  <span style={{ fontSize: 11, opacity: 0.6 }}>{entry.committed} in play</span>
                ) : null}
                <span style={{ fontSize: 12, color: toneOf(entry.net) }}>{signed(entry.net)}</span>
                <strong style={{ minWidth: 48, textAlign: 'right' }}>{entry.balance}</strong>
              </li>
            ))}
          </ul>
        )}

        {/* What it would take to close the room out right now. Winnings are
            paid by the losers, so the payments always cancel exactly. */}
        <div style={{ display: 'grid', gap: 6 }}>
          <strong style={{ fontSize: 14 }}>Settle up</strong>
          {transfers.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>
              Nobody owes anybody — everyone is level on what they bought.
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
              {transfers.map((transfer) => (
                <li key={`${transfer.from}-${transfer.to}`} style={{ fontSize: 13 }}>
                  {nameOf(transfer.from)} pays {nameOf(transfer.to)}{' '}
                  <strong>{transfer.amount}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ display: 'grid', gap: 10, borderTop: '1px solid #ecfdf5', paddingTop: 10 }}>
          <Field label="Who's buying">
            <select
              value={buyerId}
              onChange={(event) => setBuyerId(event.target.value as GamerId)}
              style={inputStyle}
            >
              <option value="">Pick a gamer</option>
              {gamers.map((gamer) => (
                <option key={gamer.id} value={gamer.id}>
                  {gamer.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Chips to buy">
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="numeric"
              placeholder="Chips"
              style={inputStyle}
            />
          </Field>

          {error ? <InlineNotice tone="warn" message={error} /> : null}

          <button type="button" disabled={busy !== null} onClick={buy} style={primaryButtonStyle}>
            {busy === 'buying-chips' ? 'Buying...' : 'Buy chips'}
          </button>
        </div>
      </div>
    </Panel>
  )
}
