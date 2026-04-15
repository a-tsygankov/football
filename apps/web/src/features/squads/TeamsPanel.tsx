import type { SquadVersion } from '@fc26/shared'
import { EaTeamCard } from '../../components/EaTeamCard.jsx'
import { FcPlayerIdentity } from '../../components/EntityIdentity.jsx'
// EaPremierLeagueLivePanel is intentionally not imported here while the local
// EA preview is hidden. The component file is kept so we can re-enable the
// preview later without restoring the implementation from scratch.
import { Field } from '../../components/Field.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { Panel } from '../../components/Panel.jsx'
import { inputStyle } from '../../styles/controls.js'
import type { SquadBrowserState } from './useSquadBrowser.js'

export function TeamsPanel({
  latestSquadVersion,
  squadPanelError,
  squadVersions,
  teams,
}: {
  latestSquadVersion: string | null
  squadPanelError: string | null
  squadVersions: ReadonlyArray<SquadVersion>
  teams: SquadBrowserState['teams']
}) {
  const showTeamDetail =
    teams.selectedClub !== null && teams.selectedClubPlayers.length > 0

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
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                  gap: 12,
                }}
              >
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
                <Field label="League">
                  <select
                    value={teams.selectedLeagueId === null ? '' : String(teams.selectedLeagueId)}
                    onChange={(event) => {
                      const raw = event.target.value
                      teams.setSelectedLeagueId(raw === '' ? null : Number.parseInt(raw, 10))
                    }}
                    style={inputStyle}
                  >
                    <option value="">— Select a league —</option>
                    {teams.leagues.map((league) => (
                      <option key={league.id} value={league.id}>
                        {league.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {teams.loading ? (
                <InlineNotice tone="info" message="Loading clubs and leagues..." />
              ) : teams.selectedLeagueId === null ? (
                <InlineNotice
                  tone="info"
                  message="Pick a league above to load its FC teams."
                />
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gap: 14,
                    // When nothing is selected the detail column is empty, so
                    // we let the club grid take the full panel width and only
                    // split into a 2-column layout once the detail column has
                    // content to render.
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
                      // 3 columns fills the phone screen better — the
                      // EaTeamCard compact size already scales to narrow
                      // tracks without clipping the star meter or ATT/MID/DEF
                      // rating boxes.
                      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    }}
                  >
                    {teams.filteredClubs.length === 0 ? (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <InlineNotice
                          tone="info"
                          message="No clubs match the selected league for this squad version."
                        />
                      </div>
                    ) : (
                      teams.filteredClubs.map((club) => (
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
                   * hook clears `selectedClubId` silently, and we don't show
                   * a "no players" message either.
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
              )}
            </div>
          )}
        </div>
      </Panel>
    </section>
  )
}
