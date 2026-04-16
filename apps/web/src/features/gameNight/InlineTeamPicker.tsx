import { useCallback, useRef, useState } from 'react'
import { COUNTRY_PILL_ORDER, type Club } from '@fc26/shared'
import { EaTeamCard } from '../../components/EaTeamCard.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { LeaguePills } from '../../components/LeaguePills.jsx'
import { primaryButtonStyle } from '../../styles/controls.js'
import type { SquadBrowserState } from '../squads/useSquadBrowser.js'

const EA_FLAG_URL_TEMPLATE =
  'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fut/items/images/mobile/flags/dark/{nationId}.png'

function flagUrl(nationId: number): string {
  return EA_FLAG_URL_TEMPLATE.replace('{nationId}', String(nationId))
}

export function InlineTeamPicker({
  side,
  gamerNames,
  squadBrowserTeams,
  onSelect,
  onCancel,
}: {
  side: 'home' | 'away'
  gamerNames: string[]
  squadBrowserTeams: SquadBrowserState['teams']
  onSelect: (club: Club) => void
  onCancel: () => void
}) {
  const touchStartX = useRef<number | null>(null)
  const [lastTapTime, setLastTapTime] = useState(0)

  const teams = squadBrowserTeams

  const currentClub =
    teams.filteredClubs.length > 0
      ? teams.filteredClubs[Math.min(teams.teamIndex, teams.filteredClubs.length - 1)] ?? null
      : null

  const navigatePrev = useCallback(() => {
    if (teams.filteredClubs.length === 0) return
    const next = teams.teamIndex <= 0 ? teams.filteredClubs.length - 1 : teams.teamIndex - 1
    teams.setTeamIndex(next)
  }, [teams])

  const navigateNext = useCallback(() => {
    if (teams.filteredClubs.length === 0) return
    const next = teams.teamIndex >= teams.filteredClubs.length - 1 ? 0 : teams.teamIndex + 1
    teams.setTeamIndex(next)
  }, [teams])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null
  }, [])

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current === null) return
      const endX = e.changedTouches[0]?.clientX ?? touchStartX.current
      const diff = endX - touchStartX.current
      touchStartX.current = null
      if (Math.abs(diff) > 50) {
        if (diff > 0) navigatePrev()
        else navigateNext()
      } else {
        const now = Date.now()
        if (now - lastTapTime < 350 && currentClub) {
          onSelect(currentClub)
        }
        setLastTapTime(now)
      }
    },
    [currentClub, lastTapTime, navigateNext, navigatePrev, onSelect],
  )

  const genderToggleStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '10px 14px',
    borderRadius: 14,
    border: active ? '1px solid #166534' : '1px solid #bbf7d0',
    background: active ? '#166534' : '#ffffff',
    color: active ? '#ecfdf5' : '#166534',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: 'Georgia, serif',
    cursor: 'pointer',
    transition: 'background 120ms, color 120ms, border-color 120ms',
  })

  const arrowButtonStyle: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: 12,
    border: '1px solid #bbf7d0',
    background: '#f0fdf4',
    color: '#166534',
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  }

  const sideLabel = side === 'home' ? 'Home' : 'Away'
  const title =
    gamerNames.length > 0
      ? `Select ${sideLabel} team for ${gamerNames.join(', ')}`
      : `Select ${sideLabel} team`

  const availableCountryIds = new Set(
    teams.leagues
      .filter((l) => (l.gender ?? 'men') === teams.gender && l.nationId !== undefined)
      .map((l) => l.nationId!),
  )
  const countryPills = COUNTRY_PILL_ORDER.filter((c) => availableCountryIds.has(c.nationId))

  return (
    <div
      style={{
        marginTop: 12,
        padding: 14,
        borderRadius: 18,
        background: '#f0fdf4',
        border: '1px solid #bbf7d0',
        display: 'grid',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong
          style={{
            fontSize: 15,
            fontFamily: 'Georgia, serif',
            color: '#166534',
          }}
        >
          {title}
        </strong>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'none',
            border: 'none',
            color: '#166534',
            fontSize: 13,
            cursor: 'pointer',
            textDecoration: 'underline',
            fontFamily: 'Georgia, serif',
            padding: '4px 8px',
          }}
        >
          Cancel
        </button>
      </div>

      {/* Gender toggle */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => {
            teams.setGender('men')
            teams.setSelectedLeagueId(null)
          }}
          style={genderToggleStyle(teams.gender === 'men')}
        >
          Men's Teams
        </button>
        <button
          type="button"
          onClick={() => {
            teams.setGender('women')
            teams.setSelectedLeagueId(null)
          }}
          style={genderToggleStyle(teams.gender === 'women')}
        >
          Women's Teams
        </button>
      </div>

      {/* Country pills */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          paddingBottom: 4,
          scrollSnapType: 'x proximity',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <button
          type="button"
          onClick={() => {
            teams.setCountryNationId(null)
            teams.setSelectedLeagueId(null)
          }}
          style={{
            flex: '0 0 auto',
            scrollSnapAlign: 'start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 999,
            border: teams.countryNationId === null ? '1px solid #166534' : '1px solid #bbf7d0',
            background: teams.countryNationId === null ? '#166534' : '#ffffff',
            color: teams.countryNationId === null ? '#ecfdf5' : '#166534',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'Georgia, serif',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          All
        </button>
        {countryPills.map((country) => {
          const active = teams.countryNationId === country.nationId
          return (
            <button
              key={country.nationId}
              type="button"
              onClick={() => {
                teams.setCountryNationId(country.nationId)
                teams.setSelectedLeagueId(null)
              }}
              style={{
                flex: '0 0 auto',
                scrollSnapAlign: 'start',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 999,
                border: active ? '1px solid #166534' : '1px solid #bbf7d0',
                background: active ? '#166534' : '#ffffff',
                color: active ? '#ecfdf5' : '#166534',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'Georgia, serif',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <img
                src={flagUrl(country.nationId)}
                alt=""
                width={16}
                height={12}
                style={{ objectFit: 'contain', borderRadius: 2 }}
                loading="lazy"
              />
              {country.label}
            </button>
          )
        })}
      </div>

      {/* League pills */}
      <LeaguePills
        leagues={teams.filteredLeagues}
        selectedLeagueId={teams.selectedLeagueId}
        onSelect={(leagueId) => {
          teams.setSelectedLeagueId(leagueId)
          teams.setTeamIndex(0)
        }}
        disabled={teams.loading}
      />

      {/* Carousel */}
      {teams.loading ? (
        <InlineNotice tone="info" message="Loading clubs and leagues..." />
      ) : teams.selectedLeagueId === null ? (
        <InlineNotice tone="info" message="Pick a league above to browse FC teams." />
      ) : teams.filteredClubs.length === 0 ? (
        <InlineNotice tone="info" message="No clubs match the selected league." />
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {/* Single card carousel */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              justifyContent: 'center',
            }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <button
              type="button"
              onClick={navigatePrev}
              style={arrowButtonStyle}
              aria-label="Previous team"
            >
              &#8592;
            </button>

            <div style={{ flex: '1 1 auto', maxWidth: 300 }}>
              {currentClub ? (
                <EaTeamCard club={currentClub} size="medium" />
              ) : null}
            </div>

            <button
              type="button"
              onClick={navigateNext}
              style={arrowButtonStyle}
              aria-label="Next team"
            >
              &#8594;
            </button>
          </div>

          {/* N of M indicator */}
          <div
            style={{
              textAlign: 'center',
              fontSize: 13,
              fontFamily: 'Georgia, serif',
              color: '#166534',
              opacity: 0.7,
            }}
          >
            {Math.min(teams.teamIndex + 1, teams.filteredClubs.length)} of{' '}
            {teams.filteredClubs.length}
          </div>

          {/* SELECT button */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => {
                if (currentClub) onSelect(currentClub)
              }}
              disabled={!currentClub}
              style={{
                ...primaryButtonStyle,
                width: '100%',
                maxWidth: 300,
                fontSize: 16,
                fontWeight: 700,
                fontFamily: 'Georgia, serif',
                textAlign: 'center',
                opacity: currentClub ? 1 : 0.5,
              }}
            >
              SELECT
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
