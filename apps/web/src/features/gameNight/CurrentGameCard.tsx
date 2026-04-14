import { useEffect, useMemo, useState } from 'react'
import {
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
}: {
  busy: BusyState
  currentGame: CurrentGame
  gamers: ReadonlyArray<Gamer>
  squadClubs: ReadonlyArray<Club>
  onInterruptGame: (request: InterruptCurrentGameRequest) => Promise<void>
  onRecordGameResult: (request: RecordCurrentGameResultRequest) => Promise<void>
}) {
  const [homeScore, setHomeScore] = useState('')
  const [awayScore, setAwayScore] = useState('')
  const [interruptComment, setInterruptComment] = useState('')
  const [scorePhoto, setScorePhoto] = useState<File | null>(null)
  const [scorePhotoUrl, setScorePhotoUrl] = useState<string | null>(null)
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

  async function submitResult(result: 'home' | 'away' | 'draw'): Promise<void> {
    if (!scorePairReady) return
    const nextHomeScore = trimmedHomeScore.length > 0 ? Number.parseInt(trimmedHomeScore, 10) : null
    const nextAwayScore = trimmedAwayScore.length > 0 ? Number.parseInt(trimmedAwayScore, 10) : null
    await onRecordGameResult({
      result,
      homeScore: nextHomeScore,
      awayScore: nextAwayScore,
    })
    setHomeScore('')
    setAwayScore('')
    setInterruptComment('')
    setScorePhoto(null)
  }

  async function submitInterrupt(): Promise<void> {
    await onInterruptGame({ comment: interruptComment.trim() || null })
    setInterruptComment('')
    setScorePhoto(null)
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 18,
          background: '#ecfdf5',
          border: '1px solid #86efac',
        }}
      >
        <strong style={{ display: 'block', fontSize: 18 }}>
          Game night live
        </strong>
        <span style={{ fontSize: 14, opacity: 0.72 }}>
          {GAME_FORMATS[currentGame.format].label} •{' '}
          {currentGame.allocationMode === 'manual'
            ? 'Manual matchup'
            : `Random via ${currentGame.selectionStrategyId}`}
        </span>
      </div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
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
          padding: 14,
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
              onChange={(event) => setScorePhoto(event.target.files?.[0] ?? null)}
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
                    onClick={() => setScorePhoto(null)}
                    style={secondaryButtonStyle}
                  >
                    Remove photo
                  </button>
                </div>
              </div>
            ) : (
              <span style={{ fontSize: 13, opacity: 0.72 }}>
                Optional. Take a picture of the TV score before saving the result.
              </span>
            )}
          </div>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <button
            type="button"
            disabled={busy !== null || !scorePairReady}
            onClick={() => void submitResult('home')}
            style={primaryButtonStyle}
          >
            {busy === 'recording-game' ? 'Saving...' : 'Home win'}
          </button>
          <button
            type="button"
            disabled={busy !== null || !scorePairReady}
            onClick={() => void submitResult('draw')}
            style={secondaryButtonStyle}
          >
            {busy === 'recording-game' ? 'Saving...' : 'Draw'}
          </button>
          <button
            type="button"
            disabled={busy !== null || !scorePairReady}
            onClick={() => void submitResult('away')}
            style={primaryButtonStyle}
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
          padding: 14,
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
