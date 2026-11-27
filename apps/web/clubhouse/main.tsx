import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Avatar, MantineProvider, SegmentedControl } from '@mantine/core'
import type { RoomBootstrapResponse, RoomScoreboardResponse } from '@fc26/shared'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import { Tabs, TabsList, TabsTrigger } from '../src/components/ui/tabs'
import { App } from '../src/App'
import { QuickResult } from './QuickResult'
import '@mantine/core/styles.css'
import '../src/index.css'
import './styles.css'

const designs = [
  { value: 'pro', label: 'Clubhouse Pro', title: 'The Clubhouse', subtitle: 'Game night dashboard' },
  { value: 'social', label: 'Social Club', title: 'Social Club', subtitle: 'Room & roster' },
  { value: 'matchday', label: 'Matchday', title: 'Matchday', subtitle: 'Match registration' },
]

function Clubhouse() {
  const [design, setDesign] = useState(() => designs.find(item => item.value === new URL(location.href).searchParams.get('design')) ?? designs[0]!)
  function select(value: string) {
    const next = designs.find(item => item.value === value)
    if (!next) return
    const url = new URL(location.href)
    url.searchParams.set('design', value)
    history.replaceState(null, '', url)
    setDesign(next)
  }
  return <div className="club" data-design={design.value}>
    <header className="mast">
      <div className="mast-inner">
        <div className="edition"><span className="live-dot" /> Football · Design preview</div>
        <div className="identity"><div><p>{design.subtitle}</p><h1>{design.title}</h1></div>
          <div className="pitch" aria-hidden="true"><i /><b /></div>
        </div>
        <div className="picker" aria-label="Preview design">
          {design.value === 'pro' ? <Tabs value={design.value} onValueChange={select}>
            <TabsList aria-label="Design">{designs.map(item => <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}</TabsList>
          </Tabs> : design.value === 'social' ? <SegmentedControl fullWidth value={design.value} onChange={select} data={designs.map(({ value, label }) => ({ value, label }))} /> :
            <ToggleGroup aria-label="Design" value={[design.value]} onValueChange={values => select(values[0] ?? design.value)}>
              {designs.map(item => <Toggle key={item.value} value={item.value}>{item.label}</Toggle>)}
            </ToggleGroup>}
        </div>
      </div>
    </header>
    <div className="playing"><App clubhouse roomOverview={(room, board, reload) => <>
      {design.value === 'pro' && <div className="desk-heading"><div><p>Game night</p><h2>Match desk</h2></div><QuickResult key={room.room.id} roomId={room.room.id} reload={reload} /></div>}
      <RoomOverview mode={design.value} room={room} board={board} />
    </>} /></div>
  </div>
}

function RoomOverview({ mode, room, board }: { mode: string; room: RoomBootstrapResponse; board: RoomScoreboardResponse | null }) {
  if (mode === 'social') return <a href="#/roster" className="room-overview members">
    <Avatar.Group>{room.gamers.slice(0, 5).map((gamer, index) =>
      <Avatar key={gamer.id} color={['violet', 'teal', 'orange'][index % 3]}>{gamer.name.replace(/^Player /, '').slice(0, 2)}</Avatar>)}</Avatar.Group>
    <span><strong>Meet the roster</strong><small>{room.gamers.length} {room.gamers.length === 1 ? 'gamer' : 'gamers'} in this room</small></span><b>↗</b>
  </a>
  if (mode === 'matchday') return <div className="room-overview match-strip">
    <strong>{room.currentGame ? 'Match in play' : 'Match setup'}</strong>
    <a href="#fc26-game-section" onClick={event => { event.preventDefault(); document.getElementById('fc26-game-section')?.scrollIntoView({ block: 'start' }) }}>Match controls ↓</a>
  </div>
  return <ClubCharts board={board} />
}

function ClubCharts({ board }: { board: RoomScoreboardResponse | null }) {
  const [metric, setMetric] = useState<'Points' | 'Goals'>('Points')
  const value = (row: RoomScoreboardResponse['gamerRows'][number]) => metric === 'Points' ? row.points : row.stats.goalsFor
  const rows = [...(board?.gamerRows ?? [])].filter(row => row.stats.gamesPlayed > 0).sort((first, second) => value(second) - value(first)).slice(0, 4)
  const leader = rows[0]
  const max = leader ? Math.max(1, value(leader)) : 1
  return <section className="chart-card" aria-label="Room performance">
    <div className="chart-heading"><h3>Club leaders</h3><div className="metric-switch" aria-label="Rank players by">{(['Points', 'Goals'] as const).map(option =>
      <button key={option} type="button" aria-pressed={metric === option} onClick={() => setMetric(option)}>{option}</button>)}</div></div>
    {leader ? <div className="stat-grid"><ol className="rank-bars">{rows.map(row => <li key={row.gamer.id}>
      <span>{row.gamer.name}</span><b>{value(row)}</b><div className="bar-track" aria-hidden="true"><i style={{width: (100 * value(row) / max) + '%'}} /></div>
    </li>)}</ol><div className="record-chart"><span>Leader’s record</span><strong>{leader.gamer.name}</strong><div className="result-track" aria-hidden="true">{[leader.stats.wins, leader.stats.draws, leader.stats.losses].map((amount, index) => <i key={index} style={{ flexGrow: amount }} />)}</div>
    <div className="result-key">{['Wins','Draws','Losses'].map((label,index) => <div key={label}><b>{[leader.stats.wins,leader.stats.draws,leader.stats.losses][index]}</b>{label}</div>)}</div></div></div> :
    <p>{board ? 'Record the first result to see the standings.' : 'Loading standings…'}</p>}
    <a href="#/scoreboard">Full scoreboard <span aria-hidden="true">↗</span></a>
  </section>
}

createRoot(document.getElementById('root')!).render(<MantineProvider><Clubhouse /></MantineProvider>)
