import { useEffect, useRef, useState } from 'react'
import { Camera, Image as ImageIcon, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Drawer } from 'vaul'
import type {
  AnalysePhotoResponse, CurrentGame, CurrentGameResponse, GameNightResponse, MatchHistoryResponse, RoomBootstrapResponse,
} from '@fc26/shared'
import { apiJson } from '../lib/api'

type Sides = [string[], string[]]
type LiveGame = { nightId: string; game: CurrentGame }

const post = <ResponseType,>(url: string, body: unknown) => apiJson<ResponseType>(url, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

export function QuickResult({ roomId, reload }: { roomId: string; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [room, setRoom] = useState<RoomBootstrapResponse | null>(null)
  const [sides, setSides] = useState<Sides>([[], []])
  const [scores, setScores] = useState(['', ''])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [reading, setReading] = useState(false)
  const [photoNote, setPhotoNote] = useState('')
  // The match the result belongs to: the room's live one, or one this dialog
  // had to start so a picture could be read against it.
  const [live, setLive] = useState<LiveGame | null>(null)
  const ocr = useRef<{ model: string; scores: string } | null>(null)
  const locked = useRef(false)
  const path = '/api/rooms/' + encodeURIComponent(roomId)
  const gamers = room?.gamers.filter(gamer => gamer.active && (!room.activeGameNight || room.activeGameNightGamers.some(entry => entry.gamerId === gamer.id))) ?? []

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setRoom(null)
    setError('')
    setPhotoNote('')
    setScores(['', ''])
    setLive(null)
    ocr.current = null
    Promise.all([apiJson<RoomBootstrapResponse>(path + '/bootstrap'), apiJson<MatchHistoryResponse>(path + '/match-history?scope=all')])
      .then(([current, history]) => {
        if (cancelled) return
        const last = history.matches[0]
        const pool = current.gamers.filter(gamer => gamer.active && (!current.activeGameNight || current.activeGameNightGamers.some(entry => entry.gamerId === gamer.id)))
        const previous = last && [...last.home.gamerIds, ...last.away.gamerIds].every(id => pool.some(gamer => gamer.id === id))
        setSides(current.currentGame ? [[...current.currentGame.homeGamerIds], [...current.currentGame.awayGamerIds]] :
          last && previous ? [[...last.home.gamerIds], [...last.away.gamerIds]] : [[pool[0]?.id ?? ''], [pool[1]?.id ?? '']])
        if (current.activeGameNight && current.currentGame) setLive({ nightId: current.activeGameNight.id, game: current.currentGame })
        setRoom(current)
      }).catch(() => { if (!cancelled) setError('Could not load the room. Close and reopen to retry.') })
    return () => { cancelled = true }
  }, [open, path])

  const games = (nightId: string) => path + '/game-nights/' + nightId + '/games'

  /** The live match, started from the chosen sides when the room has none. */
  async function ensureGame(current: RoomBootstrapResponse): Promise<LiveGame> {
    if (live) return live
    const nightId = current.activeGameNight?.id ?? (await post<GameNightResponse>(path + '/game-nights', { buyIn: 0 })).gameNight.id
    const game = (await post<CurrentGameResponse>(games(nightId), {
      allocationMode: 'manual', homeGamerIds: sides[0], awayGamerIds: sides[1],
    })).currentGame
    const started = { nightId, game }
    setLive(started)
    return started
  }

  async function save() {
    if (!room || locked.current) return
    locked.current = true
    setSaving(true)
    try {
      const { nightId, game } = await ensureGame(room)
      const homeScore = Number(scores[0])
      const awayScore = Number(scores[1])
      const fromPicture = ocr.current?.scores === scores.join('-')
      await post(games(nightId) + '/' + game.id + '/result', {
        homeScore, awayScore, result: homeScore === awayScore ? 'draw' : homeScore > awayScore ? 'home' : 'away',
        ...(fromPicture ? { entryMethod: 'ocr', ocrModel: ocr.current!.model } : {}),
      })
      toast.success('Saved · ' + homeScore + '–' + awayScore)
      setOpen(false)
    } catch {
      setRoom(null)
      setError('The save could not be confirmed. Check match history before logging it again.')
    } finally {
      try { await reload() } finally { locked.current = false; setSaving(false) }
    }
  }

  /** Reads the score off a photo of the TV, new or from the gallery. */
  async function analyse(file: File | undefined) {
    if (!file || !room || locked.current) return
    locked.current = true
    setReading(true)
    setPhotoNote('')
    // Reading a picture needs a live match, so a failed read can leave one behind.
    let liveNote = ''
    try {
      const { scaleImageForAnalysis } = await import('../lib/image.js')
      const image = await scaleImageForAnalysis(file)
      const { nightId, game } = await ensureGame(room)
      if (!room.currentGame) liveNote = ' The match is live now.'
      const result = await post<AnalysePhotoResponse>(games(nightId) + '/' + game.id + '/analyse-photo', { image })
      if (result.homeScore == null || result.awayScore == null) {
        setPhotoNote((result.error ?? 'No score could be read from that picture. Enter it by hand.') + liveNote)
      } else {
        const next = [String(result.homeScore), String(result.awayScore)]
        ocr.current = { model: result.model ?? 'gemini', scores: next.join('-') }
        setScores(next)
        setPhotoNote('Read ' + next.join('–') + ' from the picture. Check it, then save.')
      }
    } catch (failure) {
      const reason = failure instanceof Error ? failure.message : ''
      setPhotoNote((reason.includes('gemini_not_configured')
        ? 'Picture reading is not set up on this server. Enter the score by hand.'
        : 'The picture could not be read. Enter the score by hand.') + liveNote)
    } finally {
      locked.current = false
      setReading(false)
    }
  }

  const selected = sides.flat()
  const sidesValid = selected.every(Boolean) && new Set(selected).size === selected.length
  const valid = sidesValid && scores.every(score => /^\d{1,3}$/.test(score))
  const busy = saving || reading
  const sidesFixed = live !== null
  return <div className="quick-action"><Drawer.Root open={open} onOpenChange={next => { if (!locked.current) setOpen(next) }}>
    <Drawer.Trigger className="quick-launch">Log result <Plus aria-hidden="true" size={16} /></Drawer.Trigger>
    <Drawer.Portal>
      <Drawer.Overlay className="quick-overlay" />
      <Drawer.Content className="quick-sheet">
        <Drawer.Handle className="quick-handle" />
        <Drawer.Close className="quick-close" aria-label="Close"><X aria-hidden="true" size={18} /></Drawer.Close>
        <Drawer.Title>Log result</Drawer.Title>
        <Drawer.Description>{room?.currentGame ? 'Finish the live match and settle its wagers.' : 'Check the sides and enter the final score.'}</Drawer.Description>
        {room ? <form onSubmit={event => { event.preventDefault(); if (valid) void save() }}>
          <div className="quick-sides">{sides.map((players, side) => {
            const label = side === 0 ? 'Home' : 'Away'
            const available = sidesFixed ? room.gamers : gamers
            function change(next: string[]) { setSides(side === 0 ? [next, sides[1]] : [sides[0], next]) }
            return <fieldset key={label} disabled={busy} data-side={label.toLowerCase()}><legend>{label}</legend>
              {players.map((id, index) => <select key={index} aria-label={label + ' player ' + (index + 1)} value={id} disabled={sidesFixed} onChange={event => change(players.map((old, pos) => pos === index ? event.target.value : old))}>
                <option value="">Choose player</option>{available.map(gamer => <option key={gamer.id} value={gamer.id} disabled={selected.includes(gamer.id) && gamer.id !== id}>{gamer.name}</option>)}
              </select>)}
              {!sidesFixed && <button type="button" onClick={() => change(players.length === 1 ? [...players, ''] : players.slice(0, 1))}>{players.length === 1 ? '+ Teammate' : 'Remove teammate'}</button>}
              <input aria-label={label + ' final score'} inputMode="numeric" placeholder="0" maxLength={3} value={scores[side]} onChange={event => setScores(scores.map((old, index) => index === side ? event.target.value : old))} />
            </fieldset>
          })}</div>
          {!sidesFixed && <button className="quick-swap" type="button" disabled={busy} onClick={() => setSides([sides[1], sides[0]])}>⇄ Swap sides</button>}
          <div className="quick-photo" role="group" aria-label="Read the score from a picture">
            {/* Two inputs because `capture` is all-or-nothing: with it a phone
                opens the camera and offers no gallery, without it most phones
                offer the gallery first. */}
            <label data-disabled={busy || !sidesValid}><Camera aria-hidden="true" size={18} />Take photo
              <input className="sr-only" type="file" accept="image/*" capture="environment" disabled={busy || !sidesValid} onChange={event => { void analyse(event.target.files?.[0]); event.target.value = '' }} /></label>
            <label data-disabled={busy || !sidesValid}><ImageIcon aria-hidden="true" size={18} />Choose picture
              <input className="sr-only" type="file" accept="image/*" disabled={busy || !sidesValid} onChange={event => { void analyse(event.target.files?.[0]); event.target.value = '' }} /></label>
          </div>
          <p className="quick-note" role="status">{reading ? 'Reading the score from the picture…' : photoNote || (sidesFixed && !room.currentGame ? 'The match is live now, so the sides are fixed.' : '')}</p>
          <button className="quick-save" disabled={!valid || busy}>{saving ? 'Saving…' : 'Save result'}</button>
        </form> : <p role="status">{error || 'Loading sides…'}</p>}
      </Drawer.Content>
    </Drawer.Portal>
  </Drawer.Root></div>
}
