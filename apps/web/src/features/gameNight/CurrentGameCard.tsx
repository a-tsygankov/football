import { useEffect, useMemo, useState } from 'react'
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
  onAnalysePhoto: (image: string) => Promise<AnalysePhotoResponse>
}) {
  const [homeScore, setHomeScore] = useState('')
  const [awayScore, setAwayScore] = useState('')
  const [interruptComment, setInterruptComment] = useState('')
  const [scorePhoto, setScorePhoto] = useState<File | null>(null)
  const [scorePhotoUrl, setScorePhotoUrl] = useState<string | null>(null)
  const [ocrResult, setOcrResult] = useState<AnalysePhotoResponse | null>(null)
  const [ocrError, setOcrError] = useState<string | null>(null)
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

  useEffect(() => {
    if (!scorePhoto) {
      setScorePhotoUrl(null)
      return
    }

    const nextUrl = URL.createObjectURL(scorePhoto)
    setScorePhotoUrl(nextUrl)
    return () => {
      URL.revokeObjectURL(nextUrl)
    }
  }, [scorePhoto])

  function inferResult(home: number, away: number): 'home' | 'away' | 'draw' {
    if (home > away) return 'home'
    if (away > home) return 'away'
    return 'draw'
  }

  async function submitResult(result: 'home' | 'away' | 'draw'): Promise<void> {
    if (!scorePairReady) return
    const nextHomeScore = trimmedHomeScore.length > 0 ? Number.parseInt(trimmedHomeScore, 10) : null
    const nextAwayScore = trimmedAwayScore.length > 0 ? Number.parseInt(trimmedAwayScore, 10) : null
    await onRecordGameResult({
      result,
      homeScore: nextHomeScore,
      awayScore: nextAwayScore,
      ...(ocrUsed ? { entryMethod: 'ocr' as const, ocrModel: 'gemini-2.0-flash' } : {}),
    })
    setHomeScore('')
    setAwayScore('')
    setInterruptComment('')
    setScorePhoto(null)
    setOcrResult(null)
    setOcrError(null)
    setOcrUsed(false)
  }

  async function submitInterrupt(): Promise<void> {
    await onInterruptGame({ comment: interruptComment.trim() || null })
    setInterruptComment('')
    setScorePhoto(null)
    setOcrResult(null)
    setOcrError(null)
    setOcrUsed(false)
  }

  async function handleAnalysePhoto(): Promise<void> {
    if (!scorePhoto) return
    setOcrError(null)
    setOcrResult(null)

    try {
      const { scaleImageForAnalysis } = await import('../../lib/image.js')
      const base64 = await scaleImageForAnalysis(scorePhoto)
      const result = await onAnalysePhoto(base64)
      setOcrResult(result)

      if (result.homeScore != null && result.awayScore != null) {
        setHomeScore(String(result.homeScore))
        setAwayScore(String(result.awayScore))
        setOcrUsed(true)
      }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : String(err))
    }
  }

  function acceptOcrResult(): void {
    if (!ocrResult || ocrResult.homeScore == null || ocrResult.awayScore == null) return
    const result = inferResult(ocrResult.homeScore, ocrResult.awayScore)
    void submitResult(result)
  }

  function dismissOcrResult(): void {
    setOcrResult(null)
  }

  const teamsMatch = ocrResult && homeClub && awayClub
    ? fuzzyTeamMatch(ocrResult.homeTeam, homeClub.name) &&
      fuzzyTeamMatch(ocrResult.awayTeam, awayClub.name)
    : false

  const teamsSet = homeClub != null && awayClub != null

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
        <Field label="TV photo">
          <div style={{ display: 'grid', gap: 10 }}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => {
                setScorePhoto(event.target.files?.[0] ?? null)
                setOcrResult(null)
                setOcrError(null)
                setOcrUsed(false)
              }}
              style={inputStyle}
            />
            {scorePhotoUrl ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <img
                  src={scorePhotoUrl}
                  alt="Captured TV score"
                  style={{
                    width: '100%',
                    maxHeight: 220,
                    objectFit: 'cover',
                    borderRadius: 16,
                    border: '1px solid #d1fae5',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, opacity: 0.72 }}>
                    {scorePhoto?.name ?? 'TV photo ready'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setScorePhoto(null)
                      setOcrResult(null)
                      setOcrError(null)
                      setOcrUsed(false)
                    }}
                    style={secondaryButtonStyle}
                  >
                    Remove photo
                  </button>
                </div>
                {!ocrResult ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void handleAnalysePhoto()}
                    style={{ ...primaryButtonStyle, fontSize: 14 }}
                  >
                    {busy === 'analysing-photo' ? 'Analysing...' : 'Analyse photo'}
                  </button>
                ) : null}
              </div>
            ) : (
              <span style={{ fontSize: 13, opacity: 0.72 }}>
                Optional. Take a picture of the TV score to auto-fill the result.
              </span>
            )}
          </div>
        </Field>
        {ocrError ? (
          <InlineNotice tone="warn" message={`Photo analysis failed: ${ocrError}`} />
        ) : null}
        {ocrResult ? (
          <div
            style={{
              padding: 12,
              borderRadius: 14,
              background: '#ecfdf5',
              border: '1px solid #86efac',
              display: 'grid',
              gap: 10,
            }}
          >
            <strong style={{ fontSize: 14 }}>Photo result</strong>
            <p style={{ margin: 0, fontSize: 14 }}>
              {ocrResult.homeTeam ?? '?'}{' '}
              <strong>{ocrResult.homeScore ?? '?'} – {ocrResult.awayScore ?? '?'}</strong>{' '}
              {ocrResult.awayTeam ?? '?'}
            </p>
            {teamsSet && !teamsMatch ? (
              <InlineNotice
                tone="warn"
                message="Teams from photo don't match the active game. Please confirm or enter manually."
              />
            ) : null}
            {ocrResult.homeScore != null && ocrResult.awayScore != null ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={acceptOcrResult}
                  style={{ ...primaryButtonStyle, fontSize: 14 }}
                >
                  {teamsSet && teamsMatch ? 'Confirm & finish' : 'Correct, finish game'}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={dismissOcrResult}
                  style={{ ...secondaryButtonStyle, fontSize: 14 }}
                >
                  No, enter manually
                </button>
              </div>
            ) : (
              <InlineNotice tone="warn" message="Could not read score from photo. Enter the result manually." />
            )}
          </div>
        ) : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          <button
            type="button"
            disabled={busy !== null || !scorePairReady}
            onClick={() => void submitResult('home')}
            style={{ ...primaryButtonStyle, padding: '12px 8px', fontSize: 14 }}
          >
            {busy === 'recording-game' ? 'Saving...' : 'Home win'}
          </button>
          <button
            type="button"
            disabled={busy !== null || !scorePairReady}
            onClick={() => void submitResult('draw')}
            style={{ ...secondaryButtonStyle, padding: '12px 8px', fontSize: 14 }}
          >
            {busy === 'recording-game' ? 'Saving...' : 'Draw'}
          </button>
          <button
            type="button"
            disabled={busy !== null || !scorePairReady}
            onClick={() => void submitResult('away')}
            style={{ ...primaryButtonStyle, padding: '12px 8px', fontSize: 14 }}
          >
            {busy === 'recording-game' ? 'Saving...' : 'Away win'}
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.72 }}>
          Scores are optional, but if you enter them they must match the winner you pick.
        </p>
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

function fuzzyTeamMatch(ocrName: string | null, clubName: string): boolean {
  if (!ocrName) return false
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  return norm(ocrName) === norm(clubName) || norm(clubName).includes(norm(ocrName)) || norm(ocrName).includes(norm(clubName))
}
