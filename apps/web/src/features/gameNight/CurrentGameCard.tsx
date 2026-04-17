import { useMemo, useState } from 'react'
import {
  type AnalysePhotoResponse,
  type Club,
  type CurrentGame,
  type Gamer,
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
import { TeamColumn } from './TeamColumn.jsx'
import { TvPhotoCapture } from './TvPhotoCapture.jsx'

export function CurrentGameCard({
  busy,
  currentGame,
  gamers,
  squadClubs,
  onInterruptGame,
  onRecordGameResult,
  onAnalysePhoto,
}: {
  busy: BusyState
  currentGame: CurrentGame
  gamers: ReadonlyArray<Gamer>
  squadClubs: ReadonlyArray<Club>
  onInterruptGame: (request: InterruptCurrentGameRequest) => Promise<void>
  onRecordGameResult: (request: RecordCurrentGameResultRequest) => Promise<void>
  onAnalysePhoto: (
    image: string,
    homeTeam?: { name: string; aliases: string[] } | null,
    awayTeam?: { name: string; aliases: string[] } | null,
  ) => Promise<AnalysePhotoResponse>
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
  ): void {
    setHomeScore(String(hScore))
    setAwayScore(String(aScore))
    setOcrUsed(true)
    void onRecordGameResult({
      result,
      homeScore: hScore,
      awayScore: aScore,
      entryMethod: 'ocr' as const,
      ocrModel: model ?? 'gemini',
    }).then(() => {
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
      <div
        style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
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
          busy={busy}
          homeClub={homeClub}
          awayClub={awayClub}
          onAnalysePhoto={onAnalysePhoto}
          onAcceptResult={handleAcceptResult}
          onInterruptGame={() => void submitInterrupt()}
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
 * Three result buttons whose enabled state depends on the entered scores.
 *
 * - Both scores empty → all three enabled (winner-only recording).
 * - Both scores filled → only the button matching the score relationship
 *   is enabled (prevents submitting a contradictory result).
 * - One score filled / invalid pair → all disabled (incomplete entry).
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

  // When scores are filled and valid, only the correct outcome is enabled.
  const homeDisabled = busy !== null || !scorePairReady || (scoresValid && !(h > a))
  const drawDisabled = busy !== null || !scorePairReady || (scoresValid && h !== a)
  const awayDisabled = busy !== null || !scorePairReady || (scoresValid && !(a > h))

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        <button
          type="button"
          disabled={homeDisabled}
          onClick={() => onSubmit('home')}
          style={{ ...primaryButtonStyle, padding: '12px 8px', fontSize: 14 }}
        >
          {busy === 'recording-game' ? 'Saving...' : 'Home win'}
        </button>
        <button
          type="button"
          disabled={drawDisabled}
          onClick={() => onSubmit('draw')}
          style={{ ...secondaryButtonStyle, padding: '12px 8px', fontSize: 14 }}
        >
          {busy === 'recording-game' ? 'Saving...' : 'Draw'}
        </button>
        <button
          type="button"
          disabled={awayDisabled}
          onClick={() => onSubmit('away')}
          style={{ ...primaryButtonStyle, padding: '12px 8px', fontSize: 14 }}
        >
          {busy === 'recording-game' ? 'Saving...' : 'Away win'}
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 13, opacity: 0.72 }}>
        {scoresValid
          ? `Score ${h} : ${a} — only the matching result is available.`
          : 'Scores are optional. Enter both or leave both blank.'}
      </p>
    </div>
  )
}
