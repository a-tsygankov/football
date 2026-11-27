import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Gamer, MatchHistoryResponse, RoomBootstrapResponse } from '@fc26/shared'
import * as Switch from '@radix-ui/react-switch'
import { MoreHorizontal } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { gamerFallbackAvatar } from '../../lib/avatars.js'
import { Segmented } from '../../pro/Segmented.jsx'

const sides = ['home', 'bench', 'away'] as const
type Side = typeof sides[number]
const labels = { home: 'Home', bench: 'Reserve', away: 'Away' }
type Change = { to: boolean; saving: boolean; timer: ReturnType<typeof setTimeout> }

export function ProPlayerCards({ room, eligible, assignments, assign, edit, toggle, history, pendingChanged, busy, rosterOnly = false }: {
  rosterOnly?: boolean
  room: RoomBootstrapResponse
  eligible: ReadonlySet<string>
  assignments: Record<string, Side>
  assign: (id: string, side: Side) => void
  edit: (gamer: Gamer) => void
  toggle: (gamer: Gamer) => Promise<void>
  history: (scope: { type: 'all' }) => Promise<MatchHistoryResponse>
  pendingChanged: (value: boolean) => void
  busy: boolean
}) {
  const changes = useRef(new Map<string, Change>())
  const queue = useRef(Promise.resolve())
  const [, update] = useState(0)
  const [open, setOpen] = useState(false)
  const [last, setLast] = useState<Record<string, string>>({})
  const [announcement, announce] = useState('')
  const section = useRef<HTMLDivElement>(null)
  const focused = useRef<string | null>(null)
  const priorActive = useRef(new Map<string, boolean>())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const pending = changes.current
    return () => { mounted.current = false; pending.forEach(change => clearTimeout(change.timer)); pending.clear(); pendingChanged(false) }
  }, [pendingChanged])
  useEffect(() => {
    let current = true
    history({ type: 'all' }).then(({ matches }) => {
      if (!current) return
      const match = matches[0]
      setLast(match ? Object.fromEntries([...match.home.gamerIds.map(id => [id, 'Home']), ...match.away.gamerIds.map(id => [id, 'Away'])]) : {})
    }).catch(() => { if (current) setLast({}) })
    return () => { current = false }
  }, [history])
  useLayoutEffect(() => {
    for (const gamer of room.gamers) {
      const previous = priorActive.current.get(gamer.id)
      if (previous !== undefined && previous !== gamer.active) {
        if (!gamer.active && assignments[gamer.id] && assignments[gamer.id] !== 'bench') assign(gamer.id, 'bench')
        if (focused.current === gamer.id && (document.activeElement === document.body || !document.activeElement?.isConnected)) {
          const controls = section.current?.querySelectorAll<HTMLButtonElement>('[data-availability]')
          const target = Array.from(controls ?? []).find(control => control.dataset.availability === gamer.id) ??
            section.current?.querySelector<HTMLButtonElement>('[aria-controls="pro-inactive"]')
          target?.focus({ preventScroll: true })
        }
      }
      priorActive.current.set(gamer.id, gamer.active)
    }
  }, [room.gamers, assignments, assign])
  function redraw() { pendingChanged(changes.current.size > 0); update(value => value + 1) }
  function schedule(gamer: Gamer) {
    const old = changes.current.get(gamer.id)
    if (old?.saving) return
    if (old) {
      clearTimeout(old.timer); changes.current.delete(gamer.id); redraw()
      announce(gamer.name + ' stays ' + (gamer.active ? 'active' : 'inactive')); return
    }
    const change: Change = { to: !gamer.active, saving: false, timer: setTimeout(() => {
      queue.current = queue.current.then(async () => {
        if (changes.current.get(gamer.id) !== change) return
        change.saving = true; redraw()
        try { await toggle(gamer) } finally {
          if (mounted.current) { changes.current.delete(gamer.id); redraw() }
        }
      }).catch(() => {})
    }, 2000) }
    changes.current.set(gamer.id, change); redraw()
    announce(gamer.name + ' marked ' + (change.to ? 'active' : 'inactive') + '. Tap again within two seconds to cancel.')
  }
  function card(gamer: Gamer) {
    const change = changes.current.get(gamer.id), active = change?.to ?? gamer.active
    const side = assignments[gamer.id] ?? 'bench'
    const selectable = gamer.active && eligible.has(gamer.id) && !change && !busy
    const blocked = (next: Side) => !selectable || (next !== 'bench' && side !== next && room.gamers.filter(item => eligible.has(item.id) && assignments[item.id] === next).length >= 2)
    return <motion.article layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.22 }} className="pro-player" key={gamer.id} data-side={side} data-active={active} aria-label={gamer.name}>
      <img alt="" src={gamer.avatarUrl || gamerFallbackAvatar(gamer.name)} />
      <div className="pro-name"><strong>{gamer.name}</strong>{last[gamer.id] && <small>Last: {last[gamer.id]}</small>}</div>
      <Switch.Root className="pro-toggle" checked={active} aria-label={gamer.name + ' availability'} data-availability={gamer.id}
        onFocus={() => { focused.current = gamer.id }} disabled={change?.saving || (busy && !change)} onCheckedChange={() => schedule(gamer)}>
        <span className="pro-track" aria-hidden="true"><Switch.Thumb className="pro-thumb" /></span>{active ? 'Active' : 'Inactive'}
      </Switch.Root>
      <button type="button" className="pro-more" aria-label={'Edit ' + gamer.name} onClick={() => edit(gamer)}><MoreHorizontal aria-hidden="true" size={18} /></button>
      {change && <small className="pro-pending">{change.saving ? 'Saving…' : 'Moving to ' + (active ? 'active' : 'inactive') + ' · Tap again to cancel'}</small>}
      {!rosterOnly && gamer.active && <SideSegments side={side} blocked={blocked} choose={next => assign(gamer.id, next)} name={gamer.name} />}
    </motion.article>
  }
  const inactive = room.gamers.filter(gamer => !gamer.active)
  return <div ref={section} className="pro-players"><AnimatePresence initial={false}>{room.gamers.filter(gamer => gamer.active).map(card)}</AnimatePresence>
    <button type="button" aria-expanded={open} aria-controls="pro-inactive" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} Inactive ({inactive.length})</button>
    <div id="pro-inactive" hidden={!open}><AnimatePresence initial={false}>{open && inactive.map(card)}</AnimatePresence></div><span className="sr-only" role="status">{announcement}</span>
  </div>
}

function SideSegments({ side, name, blocked, choose }: { side: Side; name: string; blocked: (next: Side) => boolean; choose: (next: Side) => void }) {
  const start = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef(false)
  const options = sides.map(option => ({ value: option, label: labels[option], disabled: blocked(option) }))
  return <div className="pro-segments"
    onPointerDown={event => { suppressClick.current = false; start.current = { x: event.clientX, y: event.clientY } }}
    onPointerCancel={() => { start.current = null }}
    onPointerUp={event => {
      const origin = start.current; start.current = null
      if (!origin) return
      const dx = event.clientX - origin.x
      if (Math.abs(dx) < 28 || Math.abs(dx) < Math.abs(event.clientY - origin.y) * 1.4) return
      suppressClick.current = true
      const next = sides[Math.max(0, Math.min(2, sides.indexOf(side) + Math.sign(dx)))]!
      if (!blocked(next)) choose(next)
    }} onClickCapture={event => { if (suppressClick.current && event.detail !== 0) { event.stopPropagation(); suppressClick.current = false } }}>
    <Segmented label={'Side for ' + name} value={side} options={options} onChange={choose} />
  </div>
}
