import { useEffect, useState } from 'react'
import {
  type AnalysePhotoResponse,
  type Club,
  CLUB_NAME_ALIASES,
} from '@fc26/shared'
import { Field } from '../../components/Field.jsx'
import {
  inputStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'
import { PhotoResultPreview } from './PhotoResultPreview.jsx'

interface TeamContext {
  name: string
  aliases: string[]
}

function buildTeamContext(club: Club | null): TeamContext | null {
  if (!club) return null
  const aliases: string[] = []
  // Check if this club's name appears as an alias value (i.e. it was
  // canonicalised from an EA fake name). If so, include the original EA
  // name as an alias so the AI can match either form.
  for (const [eaName, alias] of Object.entries(CLUB_NAME_ALIASES)) {
    if (alias.name === club.name) {
      aliases.push(eaName)
    }
  }
  // Also add the short name if it differs from the full name
  if (club.shortName && club.shortName !== club.name) {
    aliases.push(club.shortName)
  }
  return { name: club.name, aliases }
}

export function TvPhotoCapture({
  busy,
  homeClub,
  awayClub,
  onAnalysePhoto,
  onAcceptResult,
  onInterruptGame,
}: {
  busy: BusyState
  homeClub: Club | null
  awayClub: Club | null
  onAnalysePhoto: (
    image: string,
    homeTeam?: TeamContext | null,
    awayTeam?: TeamContext | null,
  ) => Promise<AnalysePhotoResponse>
  onAcceptResult: (
    result: 'home' | 'away' | 'draw',
    homeScore: number,
    awayScore: number,
    model?: string,
  ) => void
  onInterruptGame: () => void
}) {
  const [scorePhoto, setScorePhoto] = useState<File | null>(null)
  const [scorePhotoUrl, setScorePhotoUrl] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<AnalysePhotoResponse | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

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

  async function handleAnalysePhoto(): Promise<void> {
    if (!scorePhoto) return
    setAnalysisError(null)
    setAnalysisResult(null)

    try {
      const { scaleImageForAnalysis } = await import('../../lib/image.js')
      const base64 = await scaleImageForAnalysis(scorePhoto)
      const homeTeam = buildTeamContext(homeClub)
      const awayTeam = buildTeamContext(awayClub)
      const result = await onAnalysePhoto(base64, homeTeam, awayTeam)
      setAnalysisResult(result)
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleAccept(): void {
    if (!analysisResult) return
    const { homeScore, awayScore } = analysisResult

    if (homeScore == null || awayScore == null) return

    let result: 'home' | 'away' | 'draw'
    if (analysisResult.result) {
      result = analysisResult.result
    } else {
      if (homeScore > awayScore) result = 'home'
      else if (awayScore > homeScore) result = 'away'
      else result = 'draw'
    }

    onAcceptResult(result, homeScore, awayScore, analysisResult.model)
    resetState()
  }

  function handleInterrupt(): void {
    onInterruptGame()
    resetState()
  }

  function handleClosePreview(): void {
    setAnalysisResult(null)
  }

  function resetState(): void {
    setScorePhoto(null)
    setAnalysisResult(null)
    setAnalysisError(null)
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Field label="TV photo">
        <div style={{ display: 'grid', gap: 10 }}>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => {
              setScorePhoto(event.target.files?.[0] ?? null)
              setAnalysisResult(null)
              setAnalysisError(null)
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
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 13, opacity: 0.72 }}>
                  {scorePhoto?.name ?? 'TV photo ready'}
                </span>
                <button
                  type="button"
                  onClick={resetState}
                  style={secondaryButtonStyle}
                >
                  Remove photo
                </button>
              </div>
              {!analysisResult ? (
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

      {analysisError ? (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 14,
            background: '#fffbeb',
            border: '1px solid #fcd34d',
            fontSize: 13,
            color: '#92400e',
          }}
        >
          Photo analysis failed: {analysisError}
        </div>
      ) : null}

      {analysisResult ? (
        <PhotoResultPreview
          result={analysisResult}
          homeClub={homeClub}
          awayClub={awayClub}
          onAccept={handleAccept}
          onInterrupt={handleInterrupt}
          onClose={handleClosePreview}
        />
      ) : null}
    </div>
  )
}
