import { useMemo, useState } from 'react'
import type { SquadPlatform, SquadVersion } from '@fc26/shared'
import { EaPremierLeagueLivePanel } from '../../components/EaPremierLeagueLivePanel.jsx'
import { EaTeamCard } from '../../components/EaTeamCard.jsx'
import { FcPlayerIdentity } from '../../components/EntityIdentity.jsx'
import { Field } from '../../components/Field.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { LeaguePills } from '../../components/LeaguePills.jsx'
import { Panel } from '../../components/Panel.jsx'
import { inputStyle } from '../../styles/controls.js'
import type { SquadBrowserState } from './useSquadBrowser.js'

export function TeamsPanel({
  latestSquadVersion,
  squadPanelError,
  squadVersions,
  teams,
  // Settings-unlocked users see an extra investigation panel that reads the
  // live EA roster feed directly (bypassing the ingest pipeline). It's a
  // diagnostic view — kept out of the casual flow because it points at a
  // local-only preview server.
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
  const showTeamDetail =
    teams.selectedClub !== null && teams.selectedClubPlayers.length > 0

  // Local name filter keeps the grid compact as leagues grow — Premier
  // League alone is 20 clubs, and lower-tier leagues in some regions
  // (Belgium, Turkey, Austria) can exceed 30. Filtering in the component
  // is fine because `filteredClubs` is already capped to a single league.
  const [nameFilter, setNameFilter] = useState('')
  const displayedClubs = useMemo(() => {
    const needle = nameFilter.trim().toLowerCase()
    if (!needle) return teams.filteredClubs
    return teams.filteredClubs.filter((club) =>
      `${club.name} ${club.shortName}`.toLowerCase().includes(needle),
    )
  }, [nameFilter, teams.filteredClubs])

  return (
    <section id="fc26-teams-section" style={{ marginTop: 18 }}>
      <Panel
        title="Teams"
        subtitle="Pick a league to browse stored FC clubs from the selected squad version."
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
              <Field label="Squad version">
                <select
                  value={teams.version ?? latestSquadVersion}
                  onChange={(event) => teams.setVersion(event.target.value)}
                  style={inputStyle}
                >
                  {squadVersions.map((version) => (
                    <option key={version.version} value={version.version}>
                      {version.version}
                    </option>
                  ))}
                </select>
              </Field>

              {/* Priority-ordered, horizontally-scrollable league pills.
                  The top men's leagues (Premier League, La Liga, Serie A…)
                  come first because `useSquadBrowser` sorts via
                  `compareLeagueNames`, so the first swipe surfaces the
                  picks 95% of gamers want. */}
              <LeaguePills
                leagues={teams.leagues}
                selectedLeagueId={teams.selectedLeagueId}
                onSelect={(leagueId) => {
                  teams.setSelectedLeagueId(leagueId)
                  setNameFilter('')
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
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {/* Name filter speeds up "I know the club, just show it"
                      without forcing the gamer to eyeball a 20+ card grid. */}
                  <input
                    type="search"
                    value={nameFilter}
                    placeholder="Filter teams by name…"
                    onChange={(event) => setNameFilter(event.target.value)}
                    style={{ ...inputStyle, padding: '10px 14px', fontSize: 14 }}
                  />

                  <div
                    style={{
                      display: 'grid',
                      gap: 14,
                      // Detail column only splits in when a club with
                      // players is selected — an empty detail pane would
                      // waste half the viewport on phones.
                      gridTemplateColumns: showTeamDetail
                        ? 'minmax(0, 1fr) minmax(0, 1fr)'
                        : 'minmax(0, 1fr)',
                      alignItems: 'start',
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gap: 10,
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                      }}
                    >
                      {displayedClubs.length === 0 ? (
                        <div style={{ gridColumn: '1 / -1' }}>
                          <InlineNotice
                            tone="info"
                            message={
                              nameFilter
                                ? `No clubs match "${nameFilter}" in this league.`
                                : 'No clubs match the selected league for this squad version.'
                            }
                          />
                        </div>
                      ) : (
                        displayedClubs.map((club) => (
                          <EaTeamCard
                            key={club.id}
                            club={club}
                            size="compact"
                            selected={teams.selectedClubId === club.id}
                            onSelect={() => teams.setSelectedClubId(club.id)}
                          />
                        ))
                      )}
                    </div>

                    {/*
                     * Detail column. Per spec we render NOTHING when the
                     * selection is empty (no players returned) — the parent
                     * hook clears `selectedClubId` silently, and we don't
                     * show a "no players" message either.
                     */}
                    {showTeamDetail && teams.selectedClub ? (
                      <div style={{ display: 'grid', gap: 12 }}>
                        <EaTeamCard club={teams.selectedClub} size="medium" />
                        <div style={{ display: 'grid', gap: 10 }}>
                          {teams.playersLoading ? (
                            <InlineNotice tone="info" message="Loading club players..." />
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
                                  subtitle={`${player.position} • PAC ${player.attributes.pace} • SHO ${player.attributes.shooting} • PAS ${player.attributes.passing}`}
                                  size={44}
                                  trailing={
                                    <div style={{ textAlign: 'right' }}>
                                      <div style={{ fontSize: 12, opacity: 0.62 }}>OVR</div>
                                      <strong style={{ fontSize: 18 }}>{player.overall}</strong>
                                    </div>
                                  }
                                />
                              </article>
                            ))
                          )}
                        </div>
                      </div>
                    ) : (
                      <div />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Panel>

      {/* EA Premier League live preview — a Settings-unlocked diagnostic
          that reads the raw EA roster feed directly. Used to spot which
          clubs are missing logos or attributes after a sync without having
          to scroll the main Teams view. Relies on the local
          `tools/squad-sync` preview server at :8790; if that server isn't
          running the panel renders an inline warning and doesn't block the
          rest of the screen. */}
      {settingsUnlocked && roomSquadPlatform ? (
        <div style={{ marginTop: 14 }}>
          <EaPremierLeagueLivePanel platform={roomSquadPlatform} />
        </div>
      ) : null}
    </section>
  )
}
