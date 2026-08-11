import { useMemo, useState } from 'react'
import {
  type AnalysePhotoResponse,
  type Bet,
  type BetId,
  type Club,
  type CurrentGame,
  type Gamer,
  type GamerId,
  type GameResult,
  GAME_FORMATS,
  type InterruptCurrentGameRequest,
  type RecordCurrentGameResultRequest,
} from '@fc26/shared'
import { Field } from '../../components/Field.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import {
  inputStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'
import { BetsPanel } from './BetsPanel.jsx'
import { TeamColumn } from './TeamColumn.jsx'
import { TvPhotoCapture } from './TvPhotoCapture.jsx'

export function CurrentGameCard({
  busy,
  currentGame,
  gamers,
  squadClubs,
  bets,
  poolGamerIds,
  onInterruptGame,
  onRecordGameResult,
  onAnalysePhoto,
  onPlaceBet,
  onRemoveBet,
  onLockBets,
}: {
  busy: BusyState
  currentGame: CurrentGame
  gamers: ReadonlyArray<Gamer>
  squadClubs: ReadonlyArray<Club>
  bets: ReadonlyArray<Bet>
  poolGamerIds: ReadonlyArray<GamerId>
  onInterruptGame: (request: InterruptCurrentGameRequest) => Promise<void>
  onRecordGameResult: (request: RecordCurrentGameResultRequest) => Promise<void>
  onAnalysePhoto: (
    image: string,
    homeTeam?: { name: string; aliases: string[] } | null,
    awayTeam?: { name: string; aliases: string[] } | null,
  ) => Promise<AnalysePhotoResponse>
  onPlaceBet: (request: { gamerId: GamerId; outcome: GameResult; stake: number }) => void
  onRemoveBet: (betId: BetId) => void
  onLockBets: () => void
}) {
  const [homeScore, setHomeScore] = useState('')
  const [awayScore, setAwayScore] = useState('')
  const [interruptComment, setInterruptComment] = useState('')
  const [ocrUsed, setOcrUsed] = useState(false)
  const trimmedHomeScore = homeScore.trim()
  const trimmedAwayScore = awayScore.trim()
  const hasScoreEntry = trimmedHomeScore.length > 0 || trimmedAwayScore.length > 0
  const validHomeScore = trimmedHomeScore.length === 0 || /^\d+$/.test(trimmedHomeScore)
  const validAwayScore = trimmedAwayScore.length === 0 || /^\d+$/.test(trimmedAwayScore)
  const scorePairReady =
    validHomeScore &&
    validAwayScore &&
    ((trimmedHomeScore.length === 0 && trimmedAwayScore.length === 0) ||
      (trimmedHomeScore.length > 0 && trimmedAwayScore.length > 0))
  const homeClub = useMemo(
    () =>
      currentGame.homeClubId != null
        ? squadClubs.find((club) => club.id === currentGame.homeClubId) ?? null
        : null,
    [currentGame.homeClubId, squadClubs],
  )
  const awayClub = useMemo(
    () =>
      currentGame.awayClubId != null
        ? squadClubs.find((club) => club.id === currentGame.awayClubId) ?? null
        : null,
    [currentGame.awayClubId, squadClubs],
  )

  async function submitResult(result: 'home' | 'away' | 'draw'): Promise<void> {
    if (!scorePairReady) return
    const nextHomeScore = trimmedHomeScore.length > 0 ? Number.parseInt(trimmedHomeScore, 10) : null
    const nextAwayScore = trimmedAwayScore.length > 0 ? Number.parseInt(trimmedAwayScore, 10) : null
    await onRecordGameResult({
      result,
      homeScore: nextHomeScore,
      awayScore: nextAwayScore,
      ...(ocrUsed ? { entryMethod: 'ocr' as const, ocrModel: 'gemini' } : {}),
    })
    setHomeScore('')
    setAwayScore('')
    setInterruptComment('')
    setOcrUsed(false)
  }

  async function submitInterrupt(): Promise<void> {
    await onInterruptGame({ comment: interruptComment.trim() || null })
    setInterruptComment('')
    setOcrUsed(false)
  }

  function handleAcceptResult(
    result: 'home' | 'away' | 'draw',
    hScore: number,
    aScore: number,
    model?: string,
    homeClubName?: string | null,
    awayClubName?: string | null,
    homeClubIdOverride?: number | null,
    awayClubIdOverride?: number | null,
  ): void {
    setHomeScore(String(hScore))
    setAwayScore(String(aScore))
    setOcrUsed(true)
    const request: RecordCurrentGameResultRequest = {
      result,
      homeScore: hScore,
      awayScore: aScore,
      entryMethod: 'ocr',
      ocrModel: model ?? 'gemini',
      homeClubName: homeClubName ?? null,
      awayClubName: awayClubName ?? null,
    }
    // Forward an override only when one was provided. `undefined` leaves the
    // active game's selection untouched on the server; `null` clears it.
    if (homeClubIdOverride !== undefined) request.homeClubId = homeClubIdOverride
    if (awayClubIdOverride !== undefined) request.awayClubId = awayClubIdOverride
    void onRecordGameResult(request).then(() => {
      setHomeScore('')
      setAwayScore('')
      setOcrUsed(false)
    })
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div
        style={{
          padding: '10px 12px',
          borderRadius: 14,
          background: '#ecfdf5',
          border: '1px solid #86efac',
          fontSize: 13,
          opacity: 0.85,
        }}
      >
        {GAME_FORMATS[currentGame.format].label} •{' '}
        {currentGame.allocationMode === 'manual'
          ? 'Manual matchup'
          : `Random via ${currentGame.selectionStrategyId}`}
      </div>
      {/* Force two columns so Home and Away stay side-by-side on a vertical
          phone screen. The TeamColumn uses the compact EaTeamCard size so each
          half fits without clipping. */}
      <div
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: '1fr 1fr',
        }}
      >
        <TeamColumn
          title="Home"
          club={homeClub}
          gamerIds={currentGame.homeGamerIds}
          gamers={gamers}
        />
        <TeamColumn
          title="Away"
          club={awayClub}
          gamerIds={currentGame.awayGamerIds}
          gamers={gamers}
        />
      </div>
      <BetsPanel
        busy={busy}
        currentGame={currentGame}
        gamers={gamers}
        poolGamerIds={poolGamerIds}
        bets={bets}
        onPlaceBet={onPlaceBet}
        onRemoveBet={onRemoveBet}
        onLockBets={onLockBets}
      />
      <div
        style={{
          padding: 12,
          borderRadius: 18,
          background: '#ffffff',
          border: '1px solid #d1fae5',
          display: 'grid',
          gap: 12,
        }}
      >
        <strong style={{ fontSize: 16 }}>Finish game</strong>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Home score">
            <input
              value={homeScore}
              onChange={(event) => setHomeScore(event.target.value)}
              inputMode="numeric"
              placeholder="Optional"
              style={inputStyle}
            />
          </Field>
          <Field label="Away score">
            <input
              value={awayScore}
              onChange={(event) => setAwayScore(event.target.value)}
              inputMode="numeric"
              placeholder="Optional"
              style={inputStyle}
            />
          </Field>
        </div>
        {!scorePairReady && hasScoreEntry ? (
          <InlineNotice tone="warn" message="Enter both scores or leave both blank." />
        ) : null}
        <TvPhotoCapture
          homeClub={homeClub}
          awayClub={awayClub}
          onAnalysePhoto={onAnalysePhoto}
          onAcceptResult={handleAcceptResult}
          onInterruptGame={() => void submitInterrupt()}
          onOpen={onLockBets}
        />
        <ResultButtons
          busy={busy}
          scorePairReady={scorePairReady}
          homeScoreValue={trimmedHomeScore}
          awayScoreValue={trimmedAwayScore}
          onSubmit={(result) => void submitResult(result)}
        />
      </div>
      <div
        style={{
          padding: 12,
          borderRadius: 18,
          background: '#fffbeb',
          border: '1px solid #fcd34d',
          display: 'grid',
          gap: 12,
        }}
      >
        <strong style={{ fontSize: 16 }}>Interrupt game</strong>
        <Field label="Comment">
          <input
            value={interruptComment}
            onChange={(event) => setInterruptComment(event.target.value)}
            placeholder="Optional note"
            maxLength={280}
            style={inputStyle}
          />
        </Field>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void submitInterrupt()}
          style={secondaryButtonStyle}
        >
          {busy === 'interrupting-game' ? 'Interrupting...' : 'Interrupt game'}
        </button>
      </div>
    </div>
  )
}

/**
 * Result buttons. Two modes:
 *
 * - Both scores empty → three buttons (Home/Draw/Away) for winner-only
 *   recording, since there is no score to derive a result from.
 * - Both scores filled → a single "Accept score" button that derives the
 *   result from the score itself; the previous three-button layout can't
 *   contradict the entered score and reduces to a single confirmation.
 * - One score filled / invalid pair → still shows the three buttons, all
 *   disabled, so the warning notice above stays meaningful.
 */
function ResultButtons({
  busy,
  scorePairReady,
  homeScoreValue,
  awayScoreValue,
  onSubmit,
}: {
  busy: BusyState
  scorePairReady: boolean
  homeScoreValue: string
  awayScoreValue: string
  onSubmit: (result: 'home' | 'away' | 'draw') => void
}) {
  const bothFilled = homeScoreValue.length > 0 && awayScoreValue.length > 0
  const h = bothFilled ? Number.parseInt(homeScoreValue, 10) : NaN
  const a = bothFilled ? Number.parseInt(awayScoreValue, 10) : NaN
  const scoresValid = bothFilled && Number.isFinite(h) && Number.isFinite(a)

  if (scoresValid && scorePairReady) {
    const derived: 'home' | 'away' | 'draw' =
      h > a ? 'home' : h < a ? 'away' : 'draw'
    const outcomeLabel =
      derived === 'home' ? 'Home win' : derived === 'away' ? 'Away win' : 'Draw'
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => onSubmit(derived)}
          style={{ ...primaryButtonStyle, padding: '12px 8px', fontSize: 14 }}
        >
          {busy === 'recording-game' ? 'Saving...' : 'Accept score'}
        </button>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.72 }}>
          Score {h} : {a} — {outcomeLabel}.
        </p>
      </div>
    )
  }

  // Scores incomplete or invalid: three winner-only buttons. All are disabled
  // when the pair isn't ready (one filled, one blank), letting the notice
  // above explain why.
  const allDisabled = busy !== null || !scorePairReady
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        <button
          type="button"
          disabled={allDisabled}
          onClick={() => onSubmit('home')}
          style={{ ...primaryButtonStyle, padding: '12px 8px', fontSize: 14 }}
        >
          {busy === 'recording-game' ? 'Saving...' : 'Home win'}
        </button>
        <button
          type="button"
          disabled={allDisabled}
          onClick={() => onSubmit('draw')}
          style={{ ...secondaryButtonStyle, padding: '12px 8px', fontSize: 14 }}
        >
          {busy === 'recording-game' ? 'Saving...' : 'Draw'}
        </button>
        <button
          type="button"
          disabled={allDisabled}
          onClick={() => onSubmit('away')}
          style={{ ...primaryButtonStyle, padding: '12px 8px', fontSize: 14 }}
        >
          {busy === 'recording-game' ? 'Saving...' : 'Away win'}
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 13, opacity: 0.72 }}>
        Scores are optional. Enter both to lock the result, or leave both blank.
      </p>
    </div>
  )
}
