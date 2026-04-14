import type { SquadPlatform, SquadVersion } from '@fc26/shared'
import { ClubIdentity } from '../../components/FcClubPanel.jsx'
import { FcPlayerIdentity } from '../../components/EntityIdentity.jsx'
import { EaPremierLeagueLivePanel } from '../../components/EaPremierLeagueLivePanel.jsx'
import { Field } from '../../components/Field.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { Panel } from '../../components/Panel.jsx'
import {
  compactButtonStyle,
  inputStyle,
  primaryButtonStyle,
} from '../../styles/controls.js'
import type { SquadBrowserState } from './useSquadBrowser.js'

export function TeamsPanel({
  latestSquadVersion,
  roomSquadPlatform,
  squadPanelError,
  squadVersions,
  teams,
}: {
  latestSquadVersion: string | null
  roomSquadPlatform: SquadPlatform
  squadPanelError: string | null
  squadVersions: ReadonlyArray<SquadVersion>
  teams: SquadBrowserState['teams']
}) {
  return (
    <section id="fc26-teams-section" style={{ marginTop: 18 }}>
      <Panel
        title="Teams"
        subtitle="Browse stored FC clubs, league logos, and player avatars from the selected squad version."
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <EaPremierLeagueLivePanel platform={roomSquadPlatform} />
          {!latestSquadVersion ? (
            <InlineNotice
              tone="warn"
              message="Retrieve club and player data in Settings to unlock the stored Teams view. The live EA preview above does not store anything."
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
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => teams.setSelectedLeagueId('all')}
                  style={teams.selectedLeagueId === 'all' ? primaryButtonStyle : compactButtonStyle}
                >
                  All leagues
                </button>
                {teams.leagues.map((league) => (
                  <button
                    key={league.id}
                    type="button"
                    onClick={() => teams.setSelectedLeagueId(league.id)}
                    style={
                      teams.selectedLeagueId === league.id
                        ? primaryButtonStyle
                        : compactButtonStyle
                    }
                  >
                    {league.name}
                  </button>
                ))}
              </div>
              <div
                style={{
                  display: 'grid',
                  gap: 14,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  alignItems: 'start',
                }}
              >
                <div style={{ display: 'grid', gap: 10 }}>
                  {teams.loading ? (
                    <InlineNotice tone="info" message="Loading clubs and leagues..." />
                  ) : teams.filteredClubs.length === 0 ? (
                    <InlineNotice
                      tone="info"
                      message="No clubs match the selected league filter for this squad version."
                    />
                  ) : (
                    teams.filteredClubs.map((club) => (
                      <button
                        key={club.id}
                        type="button"
                        onClick={() => teams.setSelectedClubId(club.id)}
                        style={{
                          textAlign: 'left',
                          borderRadius: 18,
                          padding: 14,
                          background: teams.selectedClubId === club.id ? '#ecfdf5' : '#ffffff',
                          border: `1px solid ${teams.selectedClubId === club.id ? '#22c55e' : '#d1fae5'}`,
                          color: '#052e16',
                        }}
                      >
                        <ClubIdentity
                          club={club}
                          subtitle={`${club.leagueName} • ${club.starRating} stars`}
                          size={48}
                          trailing={
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 12, opacity: 0.62 }}>OVR</div>
                              <strong style={{ fontSize: 18 }}>{club.overallRating}</strong>
                            </div>
                          }
                          nameStyle={{ fontSize: 18 }}
                        />
                      </button>
                    ))
                  )}
                </div>
                <div
                  style={{
                    borderRadius: 18,
                    padding: 14,
                    background: '#ffffff',
                    border: '1px solid #d1fae5',
                    display: 'grid',
                    gap: 12,
                  }}
                >
                  {teams.selectedClub ? (
                    <>
                      <ClubIdentity
                        club={teams.selectedClub}
                        subtitle={`${teams.selectedClub.leagueName} • ATT ${teams.selectedClub.attackRating} • MID ${teams.selectedClub.midfieldRating} • DEF ${teams.selectedClub.defenseRating}`}
                        size={60}
                        trailing={
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 12, opacity: 0.62 }}>Nation</div>
                            <strong style={{ fontSize: 18 }}>{teams.selectedClub.nationId}</strong>
                          </div>
                        }
                        nameStyle={{ fontSize: 22 }}
                      />
                      <div style={{ display: 'grid', gap: 10 }}>
                        {teams.playersLoading ? (
                          <InlineNotice tone="info" message="Loading club players..." />
                        ) : teams.selectedClubPlayers.length === 0 ? (
                          <InlineNotice tone="info" message="No stored players found for this club." />
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
                    </>
                  ) : (
                    <InlineNotice tone="info" message="Select a club to inspect its players." />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </Panel>
    </section>
  )
}
