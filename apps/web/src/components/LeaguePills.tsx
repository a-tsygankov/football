import type { SquadLeague } from '@fc26/shared'
import { resolveAssetUrl } from '../lib/api.js'

/**
 * Horizontally-scrollable league picker. Each league is a chip (crest +
 * name + club count) the user can tap to switch the active league. Priority
 * ordering is handled upstream by `useSquadBrowser` via
 * `compareLeagueNames`, so the pills naturally surface the top men's
 * leagues first and the obscure ones (lower divisions, women's, friendlies)
 * trail behind the scroll fold.
 *
 * Why a pill row instead of a `<select>`:
 *   - On phone, the native picker hides crests/club counts — pills show
 *     them inline so power users recognise leagues by badge at a glance.
 *   - Horizontal scroll with snap-stops feels tactile; the top 6–8 leagues
 *     cover 95% of picks, so the long tail living past the fold is fine.
 *   - Tap-to-filter is one fewer action than "open picker → scroll → pick".
 *
 * The component is intentionally stateless: selection + data come from the
 * parent's `useSquadBrowser` hook so it can be reused anywhere a league
 * picker is needed without duplicating state.
 */
export function LeaguePills({
  leagues,
  selectedLeagueId,
  onSelect,
  disabled = false,
}: {
  leagues: ReadonlyArray<SquadLeague>
  selectedLeagueId: number | null
  onSelect: (leagueId: number | null) => void
  disabled?: boolean
}): JSX.Element {
  if (leagues.length === 0) {
    return (
      <div
        style={{
          padding: '10px 12px',
          borderRadius: 14,
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          color: '#166534',
          fontSize: 13,
        }}
      >
        No leagues available yet.
      </div>
    )
  }
  return (
    <div
      role="tablist"
      aria-label="Filter clubs by league"
      style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        paddingBottom: 4,
        // Snap the active pill to the start so tapping near the scroll edge
        // doesn't leave the selected league half-off-screen.
        scrollSnapType: 'x proximity',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {leagues.map((league) => (
        <LeaguePill
          key={league.id}
          active={selectedLeagueId === league.id}
          disabled={disabled}
          onClick={() => onSelect(league.id)}
          label={league.name}
          logoUrl={league.logoUrl}
          count={league.clubCount}
        />
      ))}
    </div>
  )
}

function LeaguePill({
  active,
  disabled,
  onClick,
  label,
  logoUrl,
  count,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  label: string
  logoUrl: string | null
  count: number
}): JSX.Element {
  const resolvedLogo = resolveAssetUrl(logoUrl) ?? null
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onClick}
      style={{
        flex: '0 0 auto',
        scrollSnapAlign: 'start',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderRadius: 999,
        border: active ? '1px solid #166534' : '1px solid #bbf7d0',
        background: active ? '#166534' : '#ffffff',
        color: active ? '#ecfdf5' : '#166534',
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background 120ms, color 120ms, border-color 120ms',
      }}
    >
      {resolvedLogo ? (
        <img
          src={resolvedLogo}
          alt=""
          width={20}
          height={20}
          style={{ objectFit: 'contain', borderRadius: 4 }}
          loading="lazy"
        />
      ) : null}
      <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
      <span
        style={{
          fontSize: 11,
          opacity: 0.8,
          padding: '1px 6px',
          borderRadius: 999,
          background: active ? 'rgba(255,255,255,0.15)' : '#ecfdf5',
        }}
      >
        {count}
      </span>
    </button>
  )
}
