import { useEffect, useRef, useState } from 'react'
import type { CurrentGameResponse, GameNightResponse, MatchHistoryResponse, RoomBootstrapResponse } from '@fc26/shared'
import { apiJson } from '../src/lib/api'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '../src/components/ui/sheet'

type Sides = [string[], string[]]

export function QuickResult({ roomId, reload }: { roomId: string; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [room, setRoom] = useState<RoomBootstrapResponse | null>(null)
  const [sides, setSides] = useState<Sides>([[], []])
  const [scores, setScores] = useState(['', ''])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const locked = useRef(false)
  const path = '/api/rooms/' + encodeURIComponent(roomId)
  const gamers = room?.gamers.filter(gamer => gamer.active && (!room.activeGameNight || room.activeGameNightGamers.some(entry => entry.gamerId === gamer.id))) ?? []

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setRoom(null)
    setError('')
    setMessage('')
    setScores(['', ''])
    Promise.all([apiJson<RoomBootstrapResponse>(path + '/bootstrap'), apiJson<MatchHistoryResponse>(path + '/match-history?scope=all')])
      .then(([current, history]) => {
        if (cancelled) return
        const last = history.matches[0]
        const pool = current.gamers.filter(gamer => gamer.active && (!current.activeGameNight || current.activeGameNightGamers.some(entry => entry.gamerId === gamer.id)))
        const previous = last && [...last.home.gamerIds, ...last.away.gamerIds].every(id => pool.some(gamer => gamer.id === id))
        setSides(current.currentGame ? [[...current.currentGame.homeGamerIds], [...current.currentGame.awayGamerIds]] :
          last && previous ? [[...last.home.gamerIds], [...last.away.gamerIds]] : [[pool[0]?.id ?? ''], [pool[1]?.id ?? '']])
        setRoom(current)
      }).catch(() => { if (!cancelled) setError('Could not load the room. Close and reopen to retry.') })
    return () => { cancelled = true }
  }, [open, path])

  async function save() {
    if (!room || locked.current) return
    locked.current = true
    setSaving(true)
    const post = <ResponseType,>(url: string, body: unknown) => apiJson<ResponseType>(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    try {
      let nightId = room.activeGameNight?.id
      if (!nightId) nightId = (await post<GameNightResponse>(path + '/game-nights', { buyIn: 0 })).gameNight.id
      const games = path + '/game-nights/' + nightId + '/games'
      const game = room.currentGame ?? (await post<CurrentGameResponse>(games, {
        allocationMode: 'manual', homeGamerIds: sides[0], awayGamerIds: sides[1],
      })).currentGame
      const homeScore = Number(scores[0])
      const awayScore = Number(scores[1])
      await post(games + '/' + game.id + '/result', { homeScore, awayScore, result: homeScore === awayScore ? 'draw' : homeScore > awayScore ? 'home' : 'away' })
      setMessage('Saved · ' + homeScore + '–' + awayScore)
      setOpen(false)
    } catch {
      setRoom(null)
      setError('The save could not be confirmed. Check match history before logging it again.')
    } finally {
      try { await reload() } finally { locked.current = false; setSaving(false) }
    }
  }

  const selected = sides.flat()
  const valid = selected.every(Boolean) && new Set(selected).size === selected.length && scores.every(score => /^\d{1,3}$/.test(score))
  return <div className="quick-action"><Sheet open={open} onOpenChange={next => { if (!locked.current) setOpen(next) }}>
    <SheetTrigger className="quick-launch">Log result <span aria-hidden="true">＋</span></SheetTrigger>
    <SheetContent className="quick-sheet">
      <SheetTitle>Log result</SheetTitle>
      <SheetDescription>{room?.currentGame ? 'Finish the live match and settle its wagers.' : 'Check the sides and enter the final score.'}</SheetDescription>
      {room ? <form onSubmit={event => { event.preventDefault(); if (valid) void save() }}>
        <div className="quick-sides">{sides.map((players, side) => {
          const label = side === 0 ? 'Home' : 'Away'
          const available = room.currentGame ? room.gamers : gamers
          function change(next: string[]) { setSides(side === 0 ? [next, sides[1]] : [sides[0], next]) }
          return <fieldset key={label} disabled={saving}><legend>{label}</legend>
            {players.map((id, index) => <select key={index} aria-label={label + ' player ' + (index + 1)} value={id} disabled={!!room.currentGame} onChange={event => change(players.map((old, pos) => pos === index ? event.target.value : old))}>
              <option value="">Choose player</option>{available.map(gamer => <option key={gamer.id} value={gamer.id} disabled={selected.includes(gamer.id) && gamer.id !== id}>{gamer.name}</option>)}
            </select>)}
            {!room.currentGame && <button type="button" onClick={() => change(players.length === 1 ? [...players, ''] : players.slice(0, 1))}>{players.length === 1 ? '+ Teammate' : 'Remove teammate'}</button>}
            <input aria-label={label + ' final score'} inputMode="numeric" placeholder="0" maxLength={3} value={scores[side]} onChange={event => setScores(scores.map((old, index) => index === side ? event.target.value : old))} />
          </fieldset>
        })}</div>
        {!room.currentGame && <button className="quick-swap" type="button" disabled={saving} onClick={() => setSides([sides[1], sides[0]])}>⇄ Swap sides</button>}
        <button className="quick-save" disabled={!valid || saving}>{saving ? 'Saving…' : 'Save result'}</button>
      </form> : <p role="status">{error || 'Loading sides…'}</p>}
    </SheetContent>
  </Sheet><span role="status">{message}</span></div>
}
