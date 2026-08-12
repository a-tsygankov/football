import { useMemo, useState } from 'react'
import {
  type Bet,
  type BetId,
  canBack,
  type CurrentGame,
  describeIneligibility,
  type Gamer,
  type GamerId,
  type GameResult,
} from '@fc26/shared'
import { Field } from '../../components/Field.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { inputStyle, primaryButtonStyle, secondaryButtonStyle } from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'

const OUTCOMES: ReadonlyArray<{ id: GameResult; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'draw', label: 'Draw' },
  { id: 'away', label: 'Away' },
]

export function BetsPanel({
  busy,
  currentGame,
  gamers,
  poolGamerIds,
  bets,
  onPlaceBet,
  onRemoveBet,
  onLockBets,
}: {
  busy: BusyState
  currentGame: CurrentGame
  gamers: ReadonlyArray<Gamer>
  poolGamerIds: ReadonlyArray<GamerId>
  bets: ReadonlyArray<Bet>
  onPlaceBet: (request: { gamerId: GamerId; outcome: GameResult; stake: number }) => void
  onRemoveBet: (betId: BetId) => void
  onLockBets: () => void
}) {
  const [bettorId, setBettorId] = useState<GamerId | ''>('')
  const [outcome, setOutcome] = useState<GameResult>('home')
  const [stake, setStake] = useState('')
  const [error, setError] = useState<string | null>(null)

  const locked = currentGame.betsLockedAt !== null
  const pot = useMemo(() => bets.reduce((sum, item) => sum + item.stake, 0), [bets])

  const backedByOutcome = useMemo(() => {
    const totals = new Map<GameResult, number>()
    for (const item of bets) {
      totals.set(item.outcome, (totals.get(item.outcome) ?? 0) + item.stake)
    }
    return totals
  }, [bets])

  const pool = useMemo(
    () => gamers.filter((gamer) => poolGamerIds.includes(gamer.id)),
    [gamers, poolGamerIds],
  )

  function nameOf(gamerId: GamerId): string {
    return gamers.find((gamer) => gamer.id === gamerId)?.name ?? 'Unknown'
  }

  /**
   * What a winning chip returns: the whole pot divided by what backs this
   * outcome. Shown as a multiplier because that reads faster than raw totals
   * when the pot is moving between bets.
   */
  function multiplierLabel(id: GameResult): string {
    const backed = backedByOutcome.get(id) ?? 0
    if (backed === 0) return '—'
    return `${(pot / backed).toFixed(1)}×`
  }

  // Explain the disabled outcome buttons whenever the picked bettor is a
  // participant, not just when the selected outcome is the blocked one.
  const blockedOutcome =
    bettorId === ''
      ? undefined
      : OUTCOMES.find((item) => !canBack(bettorId, currentGame, item.id))
  const ineligibility =
    bettorId === '' || !blockedOutcome
      ? null
      : describeIneligibility(bettorId, currentGame, blockedOutcome.id)

  function submit(): void {
    if (bettorId === '') {
      setError('Pick who is betting.')
      return
    }
    const parsed = Number.parseInt(stake.trim(), 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError('Stake must be at least 1 chip.')
      return
    }
    if (!canBack(bettorId, currentGame, outcome)) {
      setError(describeIneligibility(bettorId, currentGame, outcome))
      return
    }
    setError(null)
    onPlaceBet({ gamerId: bettorId, outcome, stake: parsed })
    setStake('')
  }

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 18,
        background: '#ffffff',
        border: '1px solid #c7d2fe',
        display: 'grid',
        gap: 12,
      }}
    >
      <strong style={{ fontSize: 16 }}>{locked ? 'Bets locked' : 'Bets'}</strong>

      <div style={{ fontSize: 13, opacity: 0.8 }}>Pot {pot} chips</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {OUTCOMES.map((item) => (
          <div key={item.id} style={{ fontSize: 12, opacity: 0.75 }}>
            {item.label} pays {multiplierLabel(item.id)}
          </div>
        ))}
      </div>

      {bets.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>No bets yet.</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
          {bets.map((item) => (
            <li
              key={item.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}
            >
              <span style={{ flex: 1 }}>
                {nameOf(item.gamerId)} — {item.outcome} — {item.stake}
              </span>
              {locked ? null : (
                <button
                  type="button"
                  aria-label={`Remove ${nameOf(item.gamerId)}'s bet`}
                  disabled={busy !== null}
                  onClick={() => onRemoveBet(item.id)}
                  style={{ ...secondaryButtonStyle, padding: '4px 10px', fontSize: 13 }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {locked ? null : (
        <>
          <Field label="Who's betting">
            <select
              value={bettorId}
              onChange={(event) => setBettorId(event.target.value as GamerId)}
              style={inputStyle}
            >
              <option value="">Pick a gamer</option>
              {pool.map((gamer) => (
                <option key={gamer.id} value={gamer.id}>
                  {gamer.name}
                </option>
              ))}
            </select>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {OUTCOMES.map((item) => {
              const allowed = bettorId === '' || canBack(bettorId, currentGame, item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!allowed || busy !== null}
                  aria-pressed={outcome === item.id}
                  onClick={() => setOutcome(item.id)}
                  style={outcome === item.id ? primaryButtonStyle : secondaryButtonStyle}
                >
                  {item.label}
                </button>
              )
            })}
          </div>

          {ineligibility ? <InlineNotice tone="warn" message={ineligibility} /> : null}

          <Field label="Stake">
            <input
              value={stake}
              onChange={(event) => setStake(event.target.value)}
              inputMode="numeric"
              placeholder="Chips"
              style={inputStyle}
            />
          </Field>

          {error ? <InlineNotice tone="warn" message={error} /> : null}

          <button type="button" disabled={busy !== null} onClick={submit} style={primaryButtonStyle}>
            Place bet
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={onLockBets}
            style={secondaryButtonStyle}
          >
            Lock bets
          </button>
        </>
      )}
    </div>
  )
}
