import { useMemo, useState } from 'react'
import {
  GamerTeamKey,
  type MatchHistoryResponse,
  type MatchHistoryScope,
  type RoomScoreboardResponse,
} from '@fc26/shared'
import { GamerIdentity } from '../../components/GamerPanel.jsx'
import { GamerTeamIdentity } from '../../components/GamerTeamPanel.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { Panel } from '../../components/Panel.jsx'
import {
  compactButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../../styles/controls.js'
import {
  formatPercent,
  formatSignedNumber,
  sortGamerScoreboardRows,
  sortTeamScoreboardRows,
} from '../../utils/scoreboard.js'
import { MatchHistoryList } from './MatchHistoryList.jsx'

export function ScoreboardPanel({
  scoreboard,
  onLoadMatchHistory,
}: {
  scoreboard: RoomScoreboardResponse | null
  onLoadMatchHistory: (scope: MatchHistoryScope) => Promise<MatchHistoryResponse>
}) {
  const [scoreboardView, setScoreboardView] = useState<'gamers' | 'teams' | 'all'>(
    'gamers',
  )
  const [includeTeamGamesInGamerBoard, setIncludeTeamGamesInGamerBoard] = useState(true)
  // Which row is expanded into a match-history drill-down. Tracked per view so
  // switching between Gamers/Teams collapses any open panel naturally.
  const [expandedGamerId, setExpandedGamerId] = useState<string | null>(null)
  const [expandedTeamKey, setExpandedTeamKey] = useState<string | null>(null)

  const selectedGamerRows = includeTeamGamesInGamerBoard
    ? (scoreboard?.gamerRows ?? [])
    : (scoreboard?.gamerRowsWithoutTeamGames ?? [])
  const sortedGamerRows = useMemo(
    () => sortGamerScoreboardRows(selectedGamerRows),
    [selectedGamerRows],
  )
  const sortedGamerTeamRows = useMemo(
    () => sortTeamScoreboardRows(scoreboard?.gamerTeamRows ?? []),
    [scoreboard?.gamerTeamRows],
  )

  return (
    <section id="fc26-scoreboard-section" style={{ marginTop: 18 }}>
      <Panel
        title="Scoreboard"
        subtitle="Best gamers and gamer teams. Pair standings only count results earned together."
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 10,
            marginBottom: 14,
          }}
        >
          <button
            type="button"
            onClick={() => setScoreboardView('gamers')}
            style={scoreboardView === 'gamers' ? primaryButtonStyle : secondaryButtonStyle}
          >
            Gamers
          </button>
          <button
            type="button"
            onClick={() => setScoreboardView('teams')}
            style={scoreboardView === 'teams' ? primaryButtonStyle : secondaryButtonStyle}
          >
            Gamer teams
          </button>
          <button
            type="button"
            onClick={() => setScoreboardView('all')}
            style={scoreboardView === 'all' ? primaryButtonStyle : secondaryButtonStyle}
          >
            All games
          </button>
        </div>

        {scoreboardView === 'gamers' ? (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
                marginBottom: 14,
              }}
            >
              <button
                type="button"
                onClick={() => setIncludeTeamGamesInGamerBoard(true)}
                style={includeTeamGamesInGamerBoard ? primaryButtonStyle : compactButtonStyle}
              >
                Use team games
              </button>
              <button
                type="button"
                onClick={() => setIncludeTeamGamesInGamerBoard(false)}
                style={!includeTeamGamesInGamerBoard ? primaryButtonStyle : compactButtonStyle}
              >
                Ignore team games
              </button>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: 13, opacity: 0.72 }}>
              {includeTeamGamesInGamerBoard
                ? 'Individual standings include both solo and team games.'
                : 'Individual standings count only 1 vs 1 results.'}
            </p>
            {sortedGamerRows.length === 0 ? (
              <InlineNotice
                tone="info"
                message={
                  includeTeamGamesInGamerBoard
                    ? 'Record the first finished game to populate the gamer scoreboard.'
                    : 'No solo-only results yet. Finish a 1 vs 1 game to populate this board.'
                }
              />
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {sortedGamerRows.map((row, index) => {
                  const expanded = expandedGamerId === row.gamer.id
                  return (
                    <article
                      key={row.gamer.id}
                      style={{
                        borderRadius: 18,
                        padding: 14,
                        background: '#ffffff',
                        border: `1px solid ${expanded ? '#86efac' : '#d1fae5'}`,
                        display: 'grid',
                        gap: 8,
                      }}
                    >
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() =>
                          setExpandedGamerId(expanded ? null : row.gamer.id)
                        }
                        style={{
                          all: 'unset',
                          cursor: 'pointer',
                          display: 'grid',
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 12,
                          }}
                        >
                          <GamerIdentity
                            gamer={row.gamer}
                            size={46}
                            subtitle={`#${index + 1}`}
                            nameStyle={{ fontSize: 18 }}
                          />
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 12, opacity: 0.62 }}>Points</div>
                            <strong style={{ fontSize: 18 }}>{row.points}</strong>
                          </div>
                        </div>
                        <div style={{ fontSize: 14, opacity: 0.76 }}>
                          {row.points} pts • {row.stats.wins}-{row.stats.draws}-{row.stats.losses} •{' '}
                          {row.stats.gamesPlayed} games • Win rate {formatPercent(row.winRate)} • GD{' '}
                          {formatSignedNumber(row.goalDiff)}
                        </div>
                        <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>
                          {expanded ? 'Hide recent matches ▲' : 'Show recent matches ▼'}
                        </div>
                      </button>
                      {expanded ? (
                        <MatchHistoryList
                          scope={{ type: 'gamer', gamerId: row.gamer.id }}
                          onLoad={onLoadMatchHistory}
                        />
                      ) : null}
                    </article>
                  )
                })}
              </div>
            )}
          </>
        ) : scoreboardView === 'all' ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <p style={{ margin: '0 0 6px', fontSize: 13, opacity: 0.72 }}>
              Most recent games across the room (up to 20).
            </p>
            <MatchHistoryList scope={{ type: 'all' }} onLoad={onLoadMatchHistory} />
          </div>
        ) : sortedGamerTeamRows.length === 0 ? (
          <InlineNotice
            tone="info"
            message="No two-gamer team results yet. Team standings appear once pairs finish games together."
          />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {sortedGamerTeamRows.map((row, index) => {
              const expanded = expandedTeamKey === row.gamerTeamKey
              return (
                <article
                  key={row.gamerTeamKey}
                  style={{
                    borderRadius: 18,
                    padding: 14,
                    background: '#ffffff',
                    border: `1px solid ${expanded ? '#86efac' : '#d1fae5'}`,
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() =>
                      setExpandedTeamKey(expanded ? null : row.gamerTeamKey)
                    }
                    style={{ all: 'unset', cursor: 'pointer', display: 'grid', gap: 8 }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <GamerTeamIdentity
                        members={row.members}
                        size={48}
                        subtitle={`#${index + 1}`}
                        nameStyle={{ fontSize: 18 }}
                      />
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12, opacity: 0.62 }}>Points</div>
                        <strong style={{ fontSize: 18 }}>{row.points}</strong>
                      </div>
                    </div>
                    <div style={{ fontSize: 14, opacity: 0.76 }}>
                      {row.stats.wins}-{row.stats.draws}-{row.stats.losses} • {row.stats.gamesPlayed}{' '}
                      games • Win rate {formatPercent(row.winRate)} • GD {formatSignedNumber(row.goalDiff)}
                    </div>
                    <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>
                      {expanded ? 'Hide recent matches ▲' : 'Show recent matches ▼'}
                    </div>
                  </button>
                  {expanded ? (
                    <MatchHistoryList
                      scope={{
                        type: 'gamerTeam',
                        gamerTeamKey: GamerTeamKey(row.gamerTeamKey),
                      }}
                      onLoad={onLoadMatchHistory}
                    />
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </Panel>
    </section>
  )
}
