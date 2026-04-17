import type { AnalysePhotoResponse, Club } from '@fc26/shared'
import { ClubAvatar } from '../../components/FcClubPanel.jsx'
import {
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../../styles/controls.js'

export function PhotoResultPreview({
  result,
  homeClub,
  awayClub,
  onAccept,
  onInterrupt,
  onClose,
}: {
  result: AnalysePhotoResponse
  homeClub: Club | null
  awayClub: Club | null
  onAccept: () => void
  onInterrupt: () => void
  onClose: () => void
}) {
  const hasScore = result.homeScore != null && result.awayScore != null
  const teamsSet = homeClub != null && awayClub != null

  let resultLabel: string | null = null
  if (result.result === 'home') resultLabel = 'Home win'
  else if (result.result === 'away') resultLabel = 'Away win'
  else if (result.result === 'draw') resultLabel = 'Draw'

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 18,
        background: '#ffffff',
        border: '1px solid #86efac',
        display: 'grid',
        gap: 16,
        boxShadow: '0 8px 32px rgba(2,6,23,0.14)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 16, fontFamily: 'Georgia, serif', color: '#052e16' }}>
          Photo Result
        </strong>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            fontSize: 18,
            cursor: 'pointer',
            color: '#6b7280',
            padding: '4px 8px',
          }}
          aria-label="Close"
        >
          X
        </button>
      </div>

      {/* Error state */}
      {result.error && !hasScore ? (
        <div style={{ display: 'grid', gap: 12 }}>
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
            {result.error}
          </div>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>
            Close
          </button>
        </div>
      ) : (
        <>
          {/* Score display with team cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              gap: 12,
              alignItems: 'center',
            }}
          >
            {/* Home side */}
            <div style={{ display: 'grid', gap: 8, justifyItems: 'center', textAlign: 'center' }}>
              <span
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  opacity: 0.6,
                  color: '#052e16',
                }}
              >
                Home
              </span>
              {homeClub ? (
                <ClubAvatar club={homeClub} size={48} />
              ) : (
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: 'rgba(148,163,184,0.18)',
                    border: '2px solid rgba(148,163,184,0.22)',
                  }}
                />
              )}
              <span
                style={{
                  fontSize: 13,
                  fontFamily: 'Georgia, serif',
                  color: '#052e16',
                  lineHeight: 1.2,
                }}
              >
                {result.homeTeam ?? homeClub?.name ?? '?'}
              </span>
            </div>

            {/* Score */}
            <div style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
              <span
                style={{
                  fontSize: 32,
                  fontFamily: 'Georgia, serif',
                  fontWeight: 'bold',
                  color: '#052e16',
                  letterSpacing: 2,
                }}
              >
                {result.homeScore ?? '?'} : {result.awayScore ?? '?'}
              </span>
              {resultLabel ? (
                <span
                  style={{
                    fontSize: 13,
                    color: '#166534',
                    fontFamily: 'Georgia, serif',
                    fontStyle: 'italic',
                  }}
                >
                  {resultLabel}
                </span>
              ) : null}
            </div>

            {/* Away side */}
            <div style={{ display: 'grid', gap: 8, justifyItems: 'center', textAlign: 'center' }}>
              <span
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  opacity: 0.6,
                  color: '#052e16',
                }}
              >
                Away
              </span>
              {awayClub ? (
                <ClubAvatar club={awayClub} size={48} />
              ) : (
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: 'rgba(148,163,184,0.18)',
                    border: '2px solid rgba(148,163,184,0.22)',
                  }}
                />
              )}
              <span
                style={{
                  fontSize: 13,
                  fontFamily: 'Georgia, serif',
                  color: '#052e16',
                  lineHeight: 1.2,
                }}
              >
                {result.awayTeam ?? awayClub?.name ?? '?'}
              </span>
            </div>
          </div>

          {/* Action area */}
          {hasScore ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {/* Warning if teams did not match */}
              {teamsSet && !result.teamsMatched ? (
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
                  Teams on photo don't match the active game.
                </div>
              ) : null}

              {/* Error hint (e.g. low confidence) but we still have scores */}
              {result.error ? (
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
                  {result.error}
                </div>
              ) : null}

              {teamsSet && !result.teamsMatched ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button type="button" onClick={onInterrupt} style={secondaryButtonStyle}>
                    Interrupt
                  </button>
                  <button type="button" onClick={onAccept} style={primaryButtonStyle}>
                    Accept Anyway
                  </button>
                </div>
              ) : (
                <button type="button" onClick={onAccept} style={primaryButtonStyle}>
                  Accept Result
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
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
                Could not read score from the photo.
              </div>
              <button type="button" onClick={onClose} style={secondaryButtonStyle}>
                Close
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
