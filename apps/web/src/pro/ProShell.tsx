import { useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { Toaster } from 'sonner'
import type { RoomScoreboardResponse } from '@fc26/shared'
import { App } from '../App'
import { HistoryTable } from './HistoryTable'
import { QuickResult } from './QuickResult'
import { Segmented } from './Segmented'
import './pro.css'
import '../../clubhouse/public/side-colors.css'

/**
 * The Pro look around the app: masthead, match desk and the history tables.
 * Both the real app and the Clubhouse preview render this; they differ only
 * in the words on the masthead and in the preview's restrictions.
 */
export function ProShell({ edition, tagline, title, preview = false }: {
  edition: string
  tagline: string
  title: string
  preview?: boolean
}) {
  return <MotionConfig reducedMotion="user"><div className="club" data-design="pro">
    <header className="mast">
      <div className="mast-inner">
        <div className="edition"><span className="live-dot" /> {edition}</div>
        <div className="identity"><div><p>{tagline}</p><h1>{title}</h1></div>
          <div className="pitch" aria-hidden="true"><i /><b /></div>
        </div>
      </div>
    </header>
    <div className="playing"><App clubhouse preview={preview}roomOverview={(room, board, reload, route, revision) => route === 'scoreboard' || route === 'wager' ?
      <HistoryTable key={room.room.id + route} mode={route} room={room} revision={revision} /> : route === 'game' ? <>
      <div className="desk-heading"><div><p>Game night</p><h2>Match desk</h2></div><QuickResult key={room.room.id} roomId={room.room.id} reload={reload} /></div>
      <ClubCharts board={board} />
    </> : null} /></div>
    <Toaster position="top-center" richColors closeButton />
  </div></MotionConfig>
}

type Metric = 'Points' | 'Goals'
const metrics = [{ value: 'Points', label: 'Points' }, { value: 'Goals', label: 'Goals' }] as const

function startsOpen(): boolean {
  // On a phone the leaders card pushes side-picking far down the page, so it
  // starts as a one-line summary there.
  return typeof matchMedia !== 'function' || !matchMedia('(max-width: 540px)').matches
}

function ClubCharts({ board }: { board: RoomScoreboardResponse | null }) {
  const [metric, setMetric] = useState<Metric>('Points')
  const [open, setOpen] = useState(startsOpen)
  const value = (row: RoomScoreboardResponse['gamerRows'][number]) => metric === 'Points' ? row.points : row.stats.goalsFor
  const rows = [...(board?.gamerRows ?? [])].filter(row => row.stats.gamesPlayed > 0).sort((first, second) => value(second) - value(first)).slice(0, 4)
  const leader = rows[0]
  const max = leader ? Math.max(1, value(leader)) : 1
  const record = leader ? [leader.stats.wins, leader.stats.draws, leader.stats.losses] : []
  return <section className="chart-card" aria-label="Room performance">
    <div className="chart-heading">
      <button type="button" className="chart-toggle" aria-expanded={open} aria-controls="club-leaders" onClick={() => setOpen(!open)}>
        <h3>Club leaders</h3>
        {!open && leader ? <span>{leader.gamer.name} · {value(leader)} {metric.toLowerCase()}</span> : null}
        <ChevronDown aria-hidden="true" size={18} />
      </button>
      {open ? <Segmented className="seg-dark" label="Rank players by" value={metric} options={metrics} onChange={setMetric} /> : null}
    </div>
    <AnimatePresence initial={false}>{open ? <motion.div id="club-leaders" key="body" className="chart-body"
      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24 }}>
      {leader ? <div className="stat-grid"><ol className="rank-bars">{rows.map(row => <li key={row.gamer.id}>
        <span>{row.gamer.name}</span><b>{value(row)}</b><div className="bar-track" aria-hidden="true"><i key={metric} style={{ width: (100 * value(row) / max) + '%' }} /></div>
      </li>)}</ol><div className="record-chart"><span>Leader’s record</span><strong>{leader.gamer.name}</strong><div className="result-track" aria-hidden="true">{record.map((amount, index) => <i key={index} style={{ flexGrow: amount }} />)}</div>
      <div className="result-key">{['Wins', 'Draws', 'Losses'].map((label, index) => <div key={label}><b>{record[index]}</b>{label}</div>)}</div></div></div> :
      <p>{board ? 'Record the first result to see the standings.' : 'Loading standings…'}</p>}
      <a href="#/scoreboard">Full scoreboard <span aria-hidden="true">↗</span></a>
    </motion.div> : null}</AnimatePresence>
  </section>
}
