import { useEffect, useMemo, useState } from 'react'
import {
  type BetHistoryGame,
  type BetHistoryResponse,
  type Gamer,
  type GamerId,
  filterBetHistory,
  formatLocal,
  netForGamer,
} from '@fc26/shared'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { Panel } from '../../components/Panel.jsx'
import { Field } from '../../components/Field.jsx'
import { inputStyle } from '../../styles/controls.js'

const OUTCOME_LABEL: Record<string, string> = {
  home: 'Home',
  away: 'Away',
  draw: 'Draw',
}

function nameOf(gamers: ReadonlyArray<Gamer>, id: string): string {
  return gamers.find((g) => g.id === id)?.name ?? 'Unknown'
}

/** One line in a game's betting story. */
function EventLine({
  event,
  gamers,
}: {
  event: BetHistoryGame['events'][number]
  gamers: ReadonlyArray<Gamer>
}) {
  let text: string
  switch (event.type) {
    case 'bet_placed': {
      const who = nameOf(gamers, event.gamerId)
      if (!event.replaced) {
        text = `${who} backed ${OUTCOME_LABEL[event.outcome]} for ${event.stake}`
      } else if (event.replaced.outcome === event.outcome) {
        // A top-up, so report the increment — "moved to 45" would hide that
        // they added 20 to an existing 25. Since hedging landed this is the
        // only way `replaced` is written: backing another outcome opens a
        // second position rather than overwriting the first.
        const added = event.stake - event.replaced.stake
        text = `${who} added ${added} to ${OUTCOME_LABEL[event.outcome]} (now ${event.stake})`
      } else {
        // Only reachable for events written before hedging, when backing a
        // different outcome replaced the position in place.
        text = `${who} moved to ${OUTCOME_LABEL[event.outcome]} ${event.stake} (from ${OUTCOME_LABEL[event.replaced.outcome]} ${event.replaced.stake})`
      }
      break
    }
    case 'bet_removed':
      text = `${nameOf(gamers, event.gamerId)} pulled ${event.stake} off ${OUTCOME_LABEL[event.outcome]}`
      break
    case 'bets_locked':
      text = `Book closed — ${event.bets.length} bet${event.bets.length === 1 ? '' : 's'}, pot ${event.pot}`
      break
    case 'bets_discarded':
      text = `Stakes returned (${event.reason.replace(/_/g, ' ')})`
      break
  }

  return (
    <li style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
      <span style={{ overflowWrap: 'anywhere' }}>{text}</span>
      <span style={{ opacity: 0.55, whiteSpace: 'nowrap', fontSize: 11 }}>
        {formatLocal(event.occurredAt)}
      </span>
    </li>
  )
}

function GameCard({
  game,
  gamers,
  viewerId,
}: {
  game: BetHistoryGame
  gamers: ReadonlyArray<Gamer>
  viewerId: GamerId | null
}) {
  const net = viewerId ? netForGamer(game, viewerId) : null
  const players = game.playerIds.map((id) => nameOf(gamers, id)).join(', ')

  return (
    <article
      style={{
        borderRadius: 16,
        padding: 12,
        background: '#ffffff',
        border: '1px solid #d1fae5',
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14 }}>
          {players || 'Game in progress'}
        </strong>
        {net !== null ? (
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: net > 0 ? '#15803d' : net < 0 ? '#b91c1c' : '#475569',
            }}
          >
            {net > 0 ? '+' : ''}
            {net}
          </span>
        ) : game.settled ? null : (
          <span style={{ fontSize: 11, opacity: 0.6 }}>unsettled</span>
        )}
      </div>

      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
        {game.events.map((event, index) => (
          <EventLine key={`${event.type}-${index}`} event={event} gamers={gamers} />
        ))}
      </ul>

      {game.settled ? (
        <div style={{ fontSize: 12, opacity: 0.75, borderTop: '1px solid #ecfdf5', paddingTop: 6 }}>
          {game.settled.map((entry) => {
            const delta = entry.payout - entry.stake
            return (
              <div key={entry.gamerId} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{nameOf(gamers, entry.gamerId)}</span>
                <span style={{ color: delta > 0 ? '#15803d' : delta < 0 ? '#b91c1c' : '#475569' }}>
                  {delta > 0 ? '+' : ''}
                  {delta}
                </span>
              </div>
            )
          })}
        </div>
      ) : null}
    </article>
  )
}

/**
 * The betting ledger.
 *
 * The filter is a convenience, not a privacy control: the room session has no
 * per-gamer identity, so the API returns the whole room's ledger to anyone who
 * can reach it. This narrows the view to what a given person was part of —
 * either playing the game or having money on it.
 */
export function WagerPage({
  gamers,
  viewerId,
  onChangeViewer,
  showAll,
  onLoadHistory,
}: {
  gamers: ReadonlyArray<Gamer>
  /** Whose ledger to show. Null means everything. */
  viewerId: GamerId | null
  onChangeViewer: (next: GamerId | null) => void
  /** Settings-unlocked clients may switch the filter off entirely. */
  showAll: boolean
  onLoadHistory: () => Promise<BetHistoryResponse>
}) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; games: ReadonlyArray<BetHistoryGame> }
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    onLoadHistory()
      .then((res) => {
        if (!cancelled) setState({ status: 'ready', games: res.games })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          })
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = useMemo(
    () => (state.status === 'ready' ? filterBetHistory(state.games, viewerId) : []),
    [state, viewerId],
  )

  return (
    <section id="fc26-wager-section" style={{ marginTop: 18 }}>
      <Panel
        title="Wager"
        subtitle="Every bet placed, changed, locked and settled."
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Show bets for">
            <select
              value={viewerId ?? ''}
              onChange={(event) =>
                onChangeViewer(event.target.value ? (event.target.value as GamerId) : null)
              }
              style={inputStyle}
            >
              {/* Only offered when Settings is unlocked — it is the same soft
                  admin notion used elsewhere, not a server-side permission. */}
              {showAll ? <option value="">Everyone</option> : null}
              {gamers.map((gamer) => (
                <option key={gamer.id} value={gamer.id}>
                  {gamer.name}
                </option>
              ))}
            </select>
          </Field>

          {state.status === 'loading' ? (
            <InlineNotice tone="info" message="Loading betting history..." />
          ) : state.status === 'error' ? (
            <InlineNotice tone="warn" message={`Could not load history: ${state.message}`} />
          ) : visible.length === 0 ? (
            <InlineNotice
              tone="info"
              message={
                state.games.length === 0
                  ? 'No bets have been placed in this room yet.'
                  : 'No bets on games involving this gamer yet.'
              }
            />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {visible.map((game) => (
                <GameCard
                  key={game.gameId}
                  game={game}
                  gamers={gamers}
                  viewerId={viewerId}
                />
              ))}
            </div>
          )}
        </div>
      </Panel>
    </section>
  )
}
