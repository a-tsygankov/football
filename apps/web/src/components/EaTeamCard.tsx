import type { Club } from '@fc26/shared'
import { resolveEaTeamStarRating10 } from '@fc26/shared'
import { ClubAvatar } from './FcClubPanel.jsx'

/**
 * A scalable team card extracted from `EaPremierLeagueLivePanel` so it can be
 * reused inside the Teams panel selected-club view, the Game Creation team
 * picker, and the Active Game card.
 *
 * Three sizes are supported:
 *   - `compact`: ~140px wide, suitable for horizontal scrollers and pickers.
 *   - `medium`: ~200px wide, the default for Game Creation summaries.
 *   - `large`: ~260px wide, matches the original Premier League preview card.
 *
 * The card scales on every dimension (avatar, paddings, fonts, rating boxes)
 * rather than stretching, so it stays legible inside narrow panels.
 */
export type EaTeamCardSize = 'compact' | 'medium' | 'large'

export interface EaTeamCardProps {
  club: Pick<
    Club,
    | 'id'
    | 'name'
    | 'logoUrl'
    | 'avatarUrl'
    | 'leagueName'
    | 'overallRating'
    | 'attackRating'
    | 'midfieldRating'
    | 'defenseRating'
    | 'starRating'
  >
  size?: EaTeamCardSize
  /** Optional rating change indicators (e.g. for the live preview). */
  ratingDelta?: {
    overall?: number | null
    attack?: number | null
    midfield?: number | null
    defense?: number | null
  }
  /** Optional override label for the country/league line above the logo. */
  caption?: string | null
  /** Optional click target — turns the card into a button when supplied. */
  onSelect?: () => void
  selected?: boolean
}

interface SizeTokens {
  cardPadding: number
  cardMinHeight: number
  avatarSize: number
  nameFontSizeShort: number
  nameFontSizeMedium: number
  nameFontSizeLong: number
  starFontSize: number
  ratingBoxFontSize: number
  ratingLabelFontSize: number
  captionFontSize: number
}

const SIZE_TOKENS: Record<EaTeamCardSize, SizeTokens> = {
  compact: {
    cardPadding: 10,
    cardMinHeight: 168,
    avatarSize: 56,
    nameFontSizeShort: 16,
    nameFontSizeMedium: 14,
    nameFontSizeLong: 13,
    starFontSize: 13,
    ratingBoxFontSize: 16,
    ratingLabelFontSize: 9,
    captionFontSize: 10,
  },
  medium: {
    cardPadding: 14,
    cardMinHeight: 200,
    avatarSize: 76,
    nameFontSizeShort: 20,
    nameFontSizeMedium: 18,
    nameFontSizeLong: 16,
    starFontSize: 16,
    ratingBoxFontSize: 20,
    ratingLabelFontSize: 10,
    captionFontSize: 11,
  },
  large: {
    cardPadding: 18,
    cardMinHeight: 220,
    avatarSize: 92,
    nameFontSizeShort: 26,
    nameFontSizeMedium: 23,
    nameFontSizeLong: 20,
    starFontSize: 18,
    ratingBoxFontSize: 24,
    ratingLabelFontSize: 11,
    captionFontSize: 11,
  },
}

export function EaTeamCard({
  club,
  size = 'medium',
  ratingDelta,
  caption,
  onSelect,
  selected = false,
}: EaTeamCardProps) {
  const tokens = SIZE_TOKENS[size]
  const starRating10 = resolveEaTeamStarRating10(club.starRating ?? null, club.overallRating)
  const nameFontSize =
    club.name.length >= 22
      ? tokens.nameFontSizeLong
      : club.name.length >= 16
        ? tokens.nameFontSizeMedium
        : tokens.nameFontSizeShort

  const interactive = typeof onSelect === 'function'

  const cardStyle: React.CSSProperties = {
    borderRadius: 22,
    padding: tokens.cardPadding,
    minHeight: tokens.cardMinHeight,
    display: 'grid',
    alignContent: 'space-between',
    gap: tokens.cardPadding,
    background:
      'linear-gradient(180deg, rgba(3,7,18,0.18) 0%, rgba(255,255,255,0.08) 100%), linear-gradient(145deg, #03140c 0%, #0f2f22 48%, #14532d 100%)',
    color: '#ecfdf5',
    border: `1px solid ${selected ? 'rgba(34,197,94,0.92)' : 'rgba(34,197,94,0.42)'}`,
    boxShadow: selected ? '0 0 0 2px rgba(34,197,94,0.55)' : '0 8px 24px rgba(2,6,23,0.18)',
    boxSizing: 'border-box',
    width: '100%',
    cursor: interactive ? 'pointer' : 'default',
    textAlign: 'left',
    font: 'inherit',
  }

  const body = (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          fontSize: tokens.captionFontSize,
          opacity: 0.7,
        }}
      >
        <span />
        <span>{caption ?? club.leagueName}</span>
      </div>

      <div style={{ display: 'grid', justifyItems: 'center', gap: tokens.cardPadding }}>
        <ClubAvatar club={club} size={tokens.avatarSize} />
        <div style={{ textAlign: 'center', display: 'grid', gap: 6 }}>
          <strong
            style={{
              display: 'block',
              fontSize: nameFontSize,
              lineHeight: 1.05,
              maxWidth: '100%',
              overflowWrap: 'anywhere',
              textWrap: 'balance',
            }}
          >
            {club.name}
          </strong>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <StarMeter rating10={starRating10} fontSize={tokens.starFontSize} />
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gap: 8,
          borderRadius: 16,
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.08)',
          padding: tokens.cardPadding * 0.7,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 6,
          }}
        >
          <RatingBox
            label="ATT"
            value={club.attackRating}
            delta={ratingDelta?.attack ?? null}
            tokens={tokens}
          />
          <RatingBox
            label="MID"
            value={club.midfieldRating}
            delta={ratingDelta?.midfield ?? null}
            tokens={tokens}
          />
          <RatingBox
            label="DEF"
            value={club.defenseRating}
            delta={ratingDelta?.defense ?? null}
            tokens={tokens}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: tokens.captionFontSize,
            opacity: 0.7,
          }}
        >
          <span>OVR {club.overallRating}</span>
          {ratingDelta?.overall != null ? <DeltaTriangle delta={ratingDelta.overall} /> : null}
        </div>
      </div>
    </>
  )

  if (interactive) {
    return (
      <button type="button" onClick={onSelect} style={cardStyle}>
        {body}
      </button>
    )
  }
  return <div style={cardStyle}>{body}</div>
}

function RatingBox({
  label,
  value,
  delta,
  tokens,
}: {
  label: string
  value: number | null
  delta: number | null
  tokens: SizeTokens
}) {
  return (
    <div
      style={{
        borderRadius: 12,
        padding: '6px 4px',
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.08)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: tokens.ratingLabelFontSize,
          opacity: 0.68,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        <strong style={{ fontSize: tokens.ratingBoxFontSize, lineHeight: 1 }}>
          {value === null ? '—' : value}
        </strong>
        <DeltaTriangle delta={delta} />
      </div>
    </div>
  )
}

function DeltaTriangle({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null
  const isUp = delta > 0
  return (
    <span
      aria-label={isUp ? 'increased' : 'decreased'}
      title={isUp ? `Increased by ${delta}` : `Decreased by ${Math.abs(delta)}`}
      style={{
        width: 0,
        height: 0,
        borderLeft: '4px solid transparent',
        borderRight: '4px solid transparent',
        borderBottom: isUp ? '7px solid #22c55e' : undefined,
        borderTop: isUp ? undefined : '7px solid #ef4444',
        display: 'inline-block',
      }}
    />
  )
}

function StarMeter({ rating10, fontSize }: { rating10: number | null; fontSize: number }) {
  const fillWidth = Math.max(0, Math.min(100, ((rating10 ?? 0) / 10) * 100))
  const label = rating10 === null ? 'No stars' : `${(rating10 / 2).toFixed(1)} stars`
  return (
    <div style={{ display: 'grid', gap: 4, justifyItems: 'center' }}>
      <div
        aria-label={label}
        style={{
          position: 'relative',
          display: 'inline-block',
          fontSize,
          letterSpacing: 1.5,
          lineHeight: 1,
        }}
      >
        <span style={{ color: 'rgba(226,232,240,0.26)' }}>★★★★★</span>
        <span
          style={{
            position: 'absolute',
            inset: 0,
            width: `${fillWidth}%`,
            overflow: 'hidden',
            color: '#facc15',
            whiteSpace: 'nowrap',
          }}
        >
          ★★★★★
        </span>
      </div>
      <span style={{ fontSize: Math.max(10, fontSize - 6), opacity: 0.72 }}>{label}</span>
    </div>
  )
}
