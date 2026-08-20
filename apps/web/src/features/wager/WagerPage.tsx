import { useEffect, useMemo, useState } from 'react'
import {
  type BetHistoryGame,
  type BetHistoryResponse,
  type Gamer,
  type GamerId,
  type MoneyEntry,
  filterBetHistory,
  filterMoneyHistory,
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

/** The show/hide control both histories sit behind. */
function CollapseToggle({
  open,
  label,
  onToggle,
}: {
  open: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        border: '1px solid #bbf7d0',
        borderRadius: 14,
        background: '#ffffff',
        color: '#166534',
        padding: '12px 14px',
        fontSize: 14,
        fontFamily: 'inherit',
        cursor: 'pointer',
      }}
      aria-expanded={open}
    >
      <span style={{ flexGrow: 1, textAlign: 'left' }}>{label}</span>
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 160ms ease',
        }}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  )
}

/**
 * One line of the money history.
 *
 * A settlement between exactly two people is the common case and reads as the
 * sentence it is. A round with more than one payer cannot be written that way:
 * the events record each gamer's net change, not who handed cash to whom, so
 * it is reported as the round it was rather than as invented pairings.
 */
function MoneyLine({ entry, gamers }: { entry: MoneyEntry; gamers: ReadonlyArray<Gamer> }) {
  const name = (id: string) => nameOf(gamers, id)
  let text: string

  if (entry.kind === 'purchase') {
    text =
      entry.reason === 'manual'
        ? `${name(entry.gamerId)} bought ${entry.amount} chips`
        : `${name(entry.gamerId)} was bought in for ${entry.amount}`
  } else {
    const paid = [...entry.paid].sort((a, b) => b.amount - a.amount)
    const owed = paid.filter((item) => item.amount > 0)
    const owing = paid.filter((item) => item.amount < 0)
    text =
      owed.length === 1 && owing.length === 1 && owed[0] && owing[0]
        ? `${name(owing[0].gamerId)} paid ${name(owed[0].gamerId)} ${owed[0].amount}`
        : `Settled up — ${paid
            .map((item) => `${name(item.gamerId)} ${item.amount > 0 ? '+' : ''}${item.amount}`)
            .join(', ')}`
  }

  return (
    <li style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
      <span style={{ overflowWrap: 'anywhere' }}>{text}</span>
      <span style={{ opacity: 0.55, whiteSpace: 'nowrap', fontSize: 11 }}>
        {formatLocal(entry.occurredAt)}
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
  onLoadHistory,
  reloadToken = 0,
}: {
  gamers: ReadonlyArray<Gamer>
  /** Whose ledger to show. Null means everything. */
  viewerId: GamerId | null
  onChangeViewer: (next: GamerId | null) => void
  onLoadHistory: () => Promise<BetHistoryResponse>
  /** Bumped by the room whenever chips move, to pull the history again. */
  reloadToken?: number
}) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; games: ReadonlyArray<BetHistoryGame>; money: ReadonlyArray<MoneyEntry> }
  >({ status: 'loading' })
  // The history is long and mostly retrospective, so it stays out of the way
  // until asked for. The chip balances above it are the part people open this
  // page to see.
  const [expanded, setExpanded] = useState(false)
  const [moneyOpen, setMoneyOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    onLoadHistory()
      .then((res) => {
        if (!cancelled) setState({ status: 'ready', games: res.games, money: res.money })
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
    // onLoadHistory is stable via useCallback; the token is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken])

  const visible = useMemo(
    () => (state.status === 'ready' ? filterBetHistory(state.games, viewerId) : []),
    [state, viewerId],
  )
  const money = useMemo(
    () => (state.status === 'ready' ? filterMoneyHistory(state.money, viewerId) : []),
    [state, viewerId],
  )

  return (
    <section id="fc26-wager-section" style={{ marginTop: 18 }}>
      <Panel
        title="Wager"
        subtitle="Every bet placed, changed, locked and settled, and every chip bought or paid."
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Show history for">
            <select
              value={viewerId ?? ''}
              onChange={(event) =>
                onChangeViewer(event.target.value ? (event.target.value as GamerId) : null)
              }
              style={inputStyle}
            >
              {/* Everyone is always on offer. The endpoint returns the whole
                  room's ledger to any session anyway, so hiding it here only
                  stopped people seeing bets they could already fetch. */}
              <option value="">Everyone</option>
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
            <>
              <CollapseToggle
                open={expanded}
                onToggle={() => setExpanded((prev) => !prev)}
                label={`${expanded ? 'Hide' : 'Show'} ${visible.length} game${
                  visible.length === 1 ? '' : 's'
                } with bets`}
              />
              {expanded ? (
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
              ) : null}
            </>
          )}

          {/* Chips bought and debts paid. Both were recorded from the day the
              ledger existed and neither was ever shown, so a settled debt just
              vanished off the screen with nothing to say it had been paid. */}
          {state.status === 'ready' ? (
            money.length === 0 ? (
              <InlineNotice
                tone="info"
                message={
                  state.money.length === 0
                    ? 'No chips have been bought or paid in this room yet.'
                    : 'No chips bought or paid involving this gamer yet.'
                }
              />
            ) : (
              <>
                <CollapseToggle
                  open={moneyOpen}
                  onToggle={() => setMoneyOpen((prev) => !prev)}
                  label={`${moneyOpen ? 'Hide' : 'Show'} ${money.length} chip movement${
                    money.length === 1 ? '' : 's'
                  }`}
                />
                {moneyOpen ? (
                  <ul
                    aria-label="Chip movements"
                    style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}
                  >
                    {money.map((entry) => (
                      <MoneyLine
                        key={
                          entry.kind === 'settlement'
                            ? `s-${entry.settlementId}`
                            : `p-${entry.gamerId}-${entry.occurredAt}-${entry.amount}`
                        }
                        entry={entry}
                        gamers={gamers}
                      />
                    ))}
                  </ul>
                ) : null}
              </>
            )
          ) : null}
        </div>
      </Panel>
    </section>
  )
}
