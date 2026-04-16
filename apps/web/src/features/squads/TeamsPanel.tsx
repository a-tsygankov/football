import { useCallback, useRef, useState } from 'react'
import { COUNTRY_PILL_ORDER, type SquadPlatform, type SquadVersion } from '@fc26/shared'
import { EaPremierLeagueLivePanel } from '../../components/EaPremierLeagueLivePanel.jsx'
import { EaTeamCard } from '../../components/EaTeamCard.jsx'
import { FcPlayerIdentity } from '../../components/EntityIdentity.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { LeaguePills } from '../../components/LeaguePills.jsx'
import { Panel } from '../../components/Panel.jsx'
import { primaryButtonStyle } from '../../styles/controls.js'
import type { SquadBrowserState } from './useSquadBrowser.js'

const EA_FLAG_URL_TEMPLATE =
  'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fut/items/images/mobile/flags/dark/{nationId}.png'

function flagUrl(nationId: number): string {
  return EA_FLAG_URL_TEMPLATE.replace('{nationId}', String(nationId))
}

export function TeamsPanel({
  latestSquadVersion,
  squadPanelError,
  squadVersions,
  teams,
  settingsUnlocked = false,
  roomSquadPlatform,
}: {
  latestSquadVersion: string | null
  squadPanelError: string | null
  squadVersions: ReadonlyArray<SquadVersion>
  teams: SquadBrowserState['teams']
  settingsUnlocked?: boolean
  roomSquadPlatform?: SquadPlatform
}) {
  // Touch swipe tracking for carousel navigation.
  const touchStartX = useRef<number | null>(null)
  const [lastTapTime, setLastTapTime] = useState(0)

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

  const selectCurrentTeam = useCallback(() => {
    if (currentClub) {
      teams.setSelectedClubId(currentClub.id)
    }
  }, [currentClub, teams])

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
        // Detect double-tap.
        const now = Date.now()
        if (now - lastTapTime < 350) {
          selectCurrentTeam()
        }
        setLastTapTime(now)
      }
    },
    [lastTapTime, navigateNext, navigatePrev, selectCurrentTeam],
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

  // Determine available countries from the currently loaded leagues (filtered by gender).
  const availableCountryIds = new Set(
    teams.leagues
      .filter((l) => (l.gender ?? 'men') === teams.gender && l.nationId !== undefined)
      .map((l) => l.nationId!),
  )
  const countryPills = COUNTRY_PILL_ORDER.filter((c) => availableCountryIds.has(c.nationId))

  return (
    <section id="fc26-teams-section" style={{ marginTop: 18 }}>
      <Panel
        title="Teams"
        subtitle="Pick a country and league to browse FC clubs."
      >
        <div style={{ display: 'grid', gap: 14 }}>
          {!latestSquadVersion ? (
            <InlineNotice
              tone="warn"
              message="Retrieve club and player data in Settings to unlock the stored Teams view."
            />
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {squadPanelError ? <InlineNotice tone="warn" message={squadPanelError} /> : null}

              {/* Version label -- compact, not a full dropdown */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  fontFamily: 'Georgia, serif',
                  color: '#166534',
                }}
              >
                <span style={{ fontWeight: 600 }}>
                  Version: {teams.version ?? latestSquadVersion}
                </span>
                {squadVersions.length > 1 ? (
                  <select
                    value={teams.version ?? latestSquadVersion}
                    onChange={(event) => teams.setVersion(event.target.value)}
                    style={{
                      border: '1px solid #bbf7d0',
                      borderRadius: 8,
                      background: '#f0fdf4',
                      color: '#166534',
                      fontSize: 12,
                      padding: '2px 6px',
                      cursor: 'pointer',
                    }}
                  >
                    {squadVersions.map((version) => (
                      <option key={version.version} value={version.version}>
                        {version.version}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>

              {/* Gender toggle buttons */}
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

              {/* Country pills: horizontal scroll with flags */}
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
                    border:
                      teams.countryNationId === null
                        ? '1px solid #166534'
                        : '1px solid #bbf7d0',
                    background:
                      teams.countryNationId === null ? '#166534' : '#ffffff',
                    color:
                      teams.countryNationId === null ? '#ecfdf5' : '#166534',
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
                        border: active
                          ? '1px solid #166534'
                          : '1px solid #bbf7d0',
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

              {/* League pills: only leagues for selected country + gender */}
              <LeaguePills
                leagues={teams.filteredLeagues}
                selectedLeagueId={teams.selectedLeagueId}
                onSelect={(leagueId) => {
                  teams.setSelectedLeagueId(leagueId)
                  teams.setTeamIndex(0)
                }}
                disabled={teams.loading}
              />

              {teams.loading ? (
                <InlineNotice tone="info" message="Loading clubs and leagues..." />
              ) : teams.selectedLeagueId === null ? (
                <InlineNotice
                  tone="info"
                  message="Pick a league above to load its FC teams."
                />
              ) : teams.filteredClubs.length === 0 ? (
                <InlineNotice
                  tone="info"
                  message="No clubs match the selected league for this squad version."
                />
              ) : (
                <div style={{ display: 'grid', gap: 14 }}>
                  {/* Single Team Card carousel */}
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
                        <EaTeamCard
                          club={currentClub}
                          size="large"
                          selected={teams.selectedClubId === currentClub.id}
                          onSelect={selectCurrentTeam}
                        />
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
                      onClick={selectCurrentTeam}
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

                  {/* Selected club detail -- players list */}
                  {teams.selectedClub &&
                  teams.selectedClubPlayers.length > 0 ? (
                    <div style={{ display: 'grid', gap: 12 }}>
                      <EaTeamCard club={teams.selectedClub} size="medium" />
                      <div style={{ display: 'grid', gap: 10 }}>
                        {teams.playersLoading ? (
                          <InlineNotice
                            tone="info"
                            message="Loading club players..."
                          />
                        ) : (
                          teams.selectedClubPlayers.map((player) => (
                            <article
                              key={player.id}
                              style={{
                                borderRadius: 16,
                                padding: 12,
                                background: '#f8fafc',
                                border: '1px solid #d1fae5',
                              }}
                            >
                              <FcPlayerIdentity
                                player={player}
                                subtitle={`${player.position} -- PAC ${player.attributes.pace} -- SHO ${player.attributes.shooting} -- PAS ${player.attributes.passing}`}
                                size={44}
                                trailing={
                                  <div style={{ textAlign: 'right' }}>
                                    <div
                                      style={{
                                        fontSize: 12,
                                        opacity: 0.62,
                                      }}
                                    >
                                      OVR
                                    </div>
                                    <strong style={{ fontSize: 18 }}>
                                      {player.overall}
                                    </strong>
                                  </div>
                                }
                              />
                            </article>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      </Panel>

      {settingsUnlocked && roomSquadPlatform ? (
        <div style={{ marginTop: 14 }}>
          <EaPremierLeagueLivePanel platform={roomSquadPlatform} />
        </div>
      ) : null}
    </section>
  )
}
