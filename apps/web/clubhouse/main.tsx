import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { RoomScoreboardResponse } from '@fc26/shared'
import { App } from '../src/App'
import { QuickResult } from './QuickResult'
import { HistoryTable } from './HistoryTable'
import { setGamerAvatarFallback } from '../src/lib/avatars'
import '../src/index.css'
import './styles.css'
import './public/side-colors.css'

// The preview has no uploaded photos, so each gamer gets a stable sample one.
setGamerAvatarFallback(name => '/card-photos/sample-' + Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6 + '.jpg')

function Clubhouse() {
  return <div className="club" data-design="pro">
    <header className="mast">
      <div className="mast-inner">
        <div className="edition"><span className="live-dot" /> Football · Design preview</div>
        <div className="identity"><div><p>Game night dashboard</p><h1>Clubhouse Pro</h1></div>
          <div className="pitch" aria-hidden="true"><i /><b /></div>
        </div>
      </div>
    </header>
    <div className="playing"><App clubhouse roomOverview={(room, board, reload, route, revision) => route === 'scoreboard' || route === 'wager' ?
      <HistoryTable key={room.room.id + route} mode={route} room={room} revision={revision} /> : route === 'game' ? <>
      <div className="desk-heading"><div><p>Game night</p><h2>Match desk</h2></div><QuickResult key={room.room.id} roomId={room.room.id} reload={reload} /></div>
      <ClubCharts board={board} />
    </> : null} /></div>
  </div>
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
      <span>{row.gamer.name}</span><b>{value(row)}</b><div className="bar-track" aria-hidden="true"><i key={metric} style={{width: (100 * value(row) / max) + '%'}} /></div>
    </li>)}</ol><div className="record-chart"><span>Leader’s record</span><strong>{leader.gamer.name}</strong><div className="result-track" aria-hidden="true">{[leader.stats.wins, leader.stats.draws, leader.stats.losses].map((amount, index) => <i key={index} style={{ flexGrow: amount }} />)}</div>
    <div className="result-key">{['Wins','Draws','Losses'].map((label,index) => <div key={label}><b>{[leader.stats.wins,leader.stats.draws,leader.stats.losses][index]}</b>{label}</div>)}</div></div></div> :
    <p>{board ? 'Record the first result to see the standings.' : 'Loading standings…'}</p>}
    <a href="#/scoreboard">Full scoreboard <span aria-hidden="true">↗</span></a>
  </section>
}

createRoot(document.getElementById('root')!).render(<Clubhouse />)
