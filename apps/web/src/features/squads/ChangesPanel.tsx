import type { SquadVersion } from '@fc26/shared'
import { ClubIdentity } from '../../components/FcClubPanel.jsx'
import { Field } from '../../components/Field.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { MiniStat } from '../../components/MiniStat.jsx'
import { Panel } from '../../components/Panel.jsx'
import { inputStyle } from '../../styles/controls.js'
import {
  formatClubChangeField,
  formatPlayerChangeField,
} from '../../utils/squads.js'
import type { SquadBrowserState } from './useSquadBrowser.js'

export function ChangesPanel({
  latestSquadVersion,
  squadVersions,
  squadPanelError,
  changes,
}: {
  latestSquadVersion: string | null
  squadVersions: ReadonlyArray<SquadVersion>
  squadPanelError: string | null
  changes: SquadBrowserState['changes']
}) {
  return (
    <section id="fc26-changes-section" style={{ marginTop: 18 }}>
      <Panel
        title="Changes"
        subtitle="Compare stored squad snapshots to see club rating shifts and player updates between versions."
      >
        {!latestSquadVersion ? (
          <InlineNotice
            tone="warn"
            message="Retrieve club and player data in Settings to unlock the Changes view."
          />
        ) : squadVersions.length < 2 ? (
          <InlineNotice
            tone="info"
            message="At least two stored squad versions are needed before version-to-version changes can be shown."
          />
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            {squadPanelError ? <InlineNotice tone="warn" message={squadPanelError} /> : null}
            <div
              style={{
                display: 'grid',
                gap: 10,
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              <Field label="From version">
                <select
                  value={changes.fromVersion ?? ''}
                  onChange={(event) => changes.setFromVersion(event.target.value || null)}
                  style={inputStyle}
                >
                  {changes.versions
                    .filter((version) => version !== changes.toVersion)
                    .map((version) => (
                      <option key={version} value={version}>
                        {version}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="To version">
                <select
                  value={changes.toVersion ?? latestSquadVersion}
                  onChange={(event) => changes.setToVersion(event.target.value)}
                  style={inputStyle}
                >
                  {changes.versions.map((version) => (
                    <option key={version} value={version}>
                      {version}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {changes.loading ? (
              <InlineNotice tone="info" message="Loading version diff..." />
            ) : changes.diff ? (
              <>
                <div
                  style={{
                    display: 'grid',
                    gap: 10,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  }}
                >
                  <MiniStat label="Club changes" value={String(changes.diff.clubChanges.length)} />
                  <MiniStat label="Player changes" value={String(changes.diff.playerChanges.length)} />
                  <MiniStat label="Added players" value={String(changes.diff.addedPlayers.length)} />
                  <MiniStat label="Removed players" value={String(changes.diff.removedPlayers.length)} />
                </div>

                <div style={{ display: 'grid', gap: 10 }}>
                  <strong style={{ fontSize: 16 }}>Club updates</strong>
                  {changes.diff.clubChanges.length === 0 ? (
                    <InlineNotice tone="info" message="No club rating changes between these versions." />
                  ) : (
                    changes.diff.clubChanges.map((change, index) => {
                      const club = changes.clubById.get(change.clubId)
                      return (
                        <article
                          key={`${change.clubId}-${change.field}-${index}`}
                          style={{
                            borderRadius: 16,
                            padding: 12,
                            background: '#ffffff',
                            border: '1px solid #d1fae5',
                          }}
                        >
                          {club ? (
                            <ClubIdentity
                              club={club}
                              subtitle={`${formatClubChangeField(change.field)} changed from ${change.from} to ${change.to}`}
                              size={42}
                            />
                          ) : (
                            <div style={{ fontSize: 14 }}>
                              Club #{change.clubId}: {formatClubChangeField(change.field)}{' '}
                              {change.from} → {change.to}
                            </div>
                          )}
                        </article>
                      )
                    })
                  )}
                </div>

                <div style={{ display: 'grid', gap: 10 }}>
                  <strong style={{ fontSize: 16 }}>Player updates</strong>
                  {changes.diff.playerChanges.length === 0 ? (
                    <InlineNotice tone="info" message="No player stat changes between these versions." />
                  ) : (
                    changes.diff.playerChanges.map((playerChange) => (
                      <article
                        key={playerChange.playerId}
                        style={{
                          borderRadius: 16,
                          padding: 12,
                          background: '#ffffff',
                          border: '1px solid #d1fae5',
                        }}
                      >
                        <strong style={{ display: 'block', fontSize: 16 }}>{playerChange.name}</strong>
                        <span style={{ display: 'block', marginTop: 4, fontSize: 13, opacity: 0.72 }}>
                          {changes.clubById.get(playerChange.clubId)?.name ??
                            `Club #${playerChange.clubId}`}
                        </span>
                        <div style={{ marginTop: 8, fontSize: 14, opacity: 0.82 }}>
                          {playerChange.changes
                            .map(
                              (entry) =>
                                `${formatPlayerChangeField(entry.field)} ${entry.from} → ${entry.to}`,
                            )
                            .join(' • ')}
                        </div>
                      </article>
                    ))
                  )}
                </div>

                <div
                  style={{
                    display: 'grid',
                    gap: 14,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  }}
                >
                  <div style={{ display: 'grid', gap: 10 }}>
                    <strong style={{ fontSize: 16 }}>Added players</strong>
                    {changes.diff.addedPlayers.length === 0 ? (
                      <InlineNotice tone="info" message="No new players added in this version." />
                    ) : (
                      changes.diff.addedPlayers.map((player) => (
                        <article
                          key={`added-${player.playerId}`}
                          style={{
                            borderRadius: 16,
                            padding: 12,
                            background: '#ffffff',
                            border: '1px solid #d1fae5',
                            fontSize: 14,
                          }}
                        >
                          <strong>{player.name}</strong>
                          <div style={{ marginTop: 4, opacity: 0.72 }}>
                            {changes.clubById.get(player.clubId)?.name ?? `Club #${player.clubId}`}
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <strong style={{ fontSize: 16 }}>Removed players</strong>
                    {changes.diff.removedPlayers.length === 0 ? (
                      <InlineNotice tone="info" message="No players removed in this version." />
                    ) : (
                      changes.diff.removedPlayers.map((player) => (
                        <article
                          key={`removed-${player.playerId}`}
                          style={{
                            borderRadius: 16,
                            padding: 12,
                            background: '#ffffff',
                            border: '1px solid #d1fae5',
                            fontSize: 14,
                          }}
                        >
                          <strong>{player.name}</strong>
                          <div style={{ marginTop: 4, opacity: 0.72 }}>
                            {changes.clubById.get(player.clubId)?.name ?? `Club #${player.clubId}`}
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : (
              <InlineNotice tone="info" message="Pick two stored versions to inspect their differences." />
            )}
          </div>
        )}
      </Panel>
    </section>
  )
}
