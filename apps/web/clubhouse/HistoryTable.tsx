import { Fragment, useEffect, useState } from 'react'
import type { BetHistoryResponse, MatchHistoryResponse, RoomBootstrapResponse } from '@fc26/shared'
import { apiJson } from '../src/lib/api'

interface Row {
  id: string
  date: number
  cells: string[]
  order: (string | number)[]
  details: string[]
}

const time = (stamp: number) => new Date(stamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const sides = { home: 'Home', away: 'Away', draw: 'Draw' }

function resultRows(history: MatchHistoryResponse): Row[] {
  return history.matches.map(match => {
    const home = match.home.gamers.map(gamer => gamer.name).join(' + ')
    const away = match.away.gamers.map(gamer => gamer.name).join(' + ')
    const score = match.home.score === null || match.away.score === null ? sides[match.result] : match.home.score + '–' + match.away.score
    return { id: match.eventId, date: match.occurredAt, cells: [home, score, away],
      order: [home, (match.home.score ?? 0) + (match.away.score ?? 0), away],
      details: [match.format, match.result === 'draw' ? 'Draw' : sides[match.result] + ' win', ...[match.home.clubName, match.away.clubName].filter((club): club is string => !!club)] }
  })
}

function wagerRows(history: BetHistoryResponse, room: RoomBootstrapResponse): Row[] {
  const names = new Map(room.gamers.map(gamer => [gamer.id, gamer.name]))
  return history.games.map(book => {
    const players = book.playerIds.map(id => names.get(id) ?? 'Former player').join(' · ')
    const status = book.settled ? 'Settled' : book.events.some(event => event.type === 'bets_discarded') ? 'Returned' :
      book.events.some(event => event.type === 'bets_locked') ? 'Locked' : 'Open'
    const details = book.events.map(event => {
      switch (event.type) {
        case 'bet_placed': return (names.get(event.gamerId) ?? 'Former player') + ' backed ' + sides[event.outcome] + ' · ' + event.stake + ' chips'
        case 'bet_removed': return (names.get(event.gamerId) ?? 'Former player') + ' removed ' + event.stake + ' chips'
        case 'bets_locked': return 'Book locked · ' + event.pot + ' chips'
        case 'bets_discarded': return 'Stakes returned · ' + event.reason.replaceAll('_', ' ')
      }
    })
    for (const position of book.settled ?? []) details.push((names.get(position.gamerId) ?? 'Former player') + ' · ' + sides[position.outcome] + ' · staked ' + position.stake + ', paid out ' + position.payout)
    return { id: book.gameId, date: book.occurredAt, cells: [players || 'Game book', status, String(book.events.length)],
      order: [players, status, book.events.length], details }
  })
}

export function HistoryTable({ mode, room, revision }: { mode: 'scoreboard' | 'wager'; room: RoomBootstrapResponse; revision: number }) {
  const results = mode === 'scoreboard'
  const title = results ? 'Match results' : 'Wager books'
  const labels = results ? ['Played', 'Home', 'Score', 'Away'] : ['Updated', 'Players', 'Status', 'Events']
  const [rows, setRows] = useState<Row[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState({ column: 0, direction: -1 })
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState('')
  const [state, setState] = useState('Loading…')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    const base = '/api/rooms/' + encodeURIComponent(room.room.id)
    const response = results ? apiJson<MatchHistoryResponse>(base + '/match-history?scope=all&view=table').then(resultRows) :
      apiJson<BetHistoryResponse>(base + '/bet-history').then(history => wagerRows(history, room))
    response.then(items => { if (current) { setRows(items); setState('') } }).catch(() => { if (current) setState('Could not load history.') })
    return () => { current = false }
  }, [results, room, revision, attempt])
  const filtered = rows.filter(row => [...row.cells, ...row.details].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
    .sort((first, second) => {
      const left = [first.date, ...first.order][sort.column] ?? ''
      const right = [second.date, ...second.order][sort.column] ?? ''
      return sort.direction * (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right)))
    })
  const pages = Math.max(1, Math.ceil(filtered.length / 8))
  const currentPage = Math.min(page, pages - 1)
  const visible = filtered.slice(currentPage * 8, currentPage * 8 + 8)
  return <section className="history-desk" aria-label={title}>
    <header><h2>{title}</h2><span>{rows.length} {results ? 'matches' : 'books'}</span></header>
    <input type="search" aria-label={'Search ' + title.toLowerCase()} placeholder={results ? 'Find a player or club' : 'Find a player or status'} value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} />
    <div className="history-scroll"><table><thead><tr>{labels.map((label, column) => <th key={label} scope="col" aria-sort={sort.column !== column ? 'none' : sort.direction === 1 ? 'ascending' : 'descending'}>
      <button type="button" onClick={() => { setSort({ column, direction: sort.column === column ? -sort.direction : 1 }); setPage(0) }}>{label} <span aria-hidden="true">{sort.column === column ? sort.direction === 1 ? '↑' : '↓' : '↕'}</span></button>
    </th>)}</tr></thead><tbody key={[sort.column, sort.direction, currentPage].join('-')}>{visible.map((row, index) => <Fragment key={row.id}>
      <tr className="history-line" style={{ animationDelay: index * 48 + 'ms' }}><td><button type="button" aria-label={'Details for ' + row.cells.join(' ') + ', ' + time(row.date)} aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? '' : row.id)}><span className="row-arrow">›</span> {time(row.date)}</button></td>
        {row.cells.map((cell, pos) => <td key={pos}>{cell}</td>)}</tr>
      {expanded === row.id && <tr><td colSpan={4}><div className="history-details">{row.details.map((detail, pos) => <p key={pos}>{detail}</p>)}</div></td></tr>}
    </Fragment>)}</tbody></table></div>
    {state ? <p role="status">{state} {state.includes('Could') && <button onClick={() => setAttempt(value => value + 1)}>Retry</button>}</p> : !visible.length && <p>No matching {results ? 'results' : 'wagers'}.</p>}
    {pages > 1 && <footer><button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>← Previous</button><span>{currentPage + 1} / {pages}</span><button disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>Next →</button></footer>}
  </section>
}
