import { useEffect, useMemo, useState } from 'react'
import {
  compareLeagueNames,
  resolveEaTeamStarRating10,
  type Club,
  type CreateCurrentGameRequest,
  GAME_FORMATS,
  type Gamer,
  type InterruptCurrentGameRequest,
  type RecordCurrentGameResultRequest,
  type RoomBootstrapResponse,
  type SquadLeague,
  inferGameFormat,
  listStrategies,
} from '@fc26/shared'
import { Field } from '../../components/Field.jsx'
import { GamerIdentity } from '../../components/GamerPanel.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { Panel } from '../../components/Panel.jsx'
import { RatingSelector, StarRow } from '../../components/RatingSelector.jsx'
import {
  compactButtonStyle,
  inputStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'
import { buildManualAssignments } from '../../utils/roster.js'
import { CurrentGameCard } from './CurrentGameCard.jsx'

export function GameCreationPanel({
  bootstrap,
  busy,
  activeGameNightGamers,
  activeGameNightGamerIds,
  latestSquadVersion,
  squadClubs,
  squadLeagues,
  squadLoading,
  onCreateGame,
  onInterruptGame,
  onRecordGameResult,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  activeGameNightGamers: ReadonlyArray<Gamer>
  activeGameNightGamerIds: ReadonlySet<string>
  latestSquadVersion: string | null
  squadClubs: ReadonlyArray<Club>
  squadLeagues: ReadonlyArray<SquadLeague>
  squadLoading: boolean
  onCreateGame: (gameNightId: string, request: CreateCurrentGameRequest) => Promise<void>
  onInterruptGame: (
    gameNightId: string,
    gameId: string,
    request: InterruptCurrentGameRequest,
  ) => Promise<void>
  onRecordGameResult: (
    gameNightId: string,
    gameId: string,
    request: RecordCurrentGameResultRequest,
  ) => Promise<void>
}) {
  const strategyOptions = useMemo(() => listStrategies(), [])
  const leagueOptions = useMemo(
    () => [...squadLeagues].sort((left, right) => compareLeagueNames(left.name, right.name)),
    [squadLeagues],
  )
  const [allocationMode, setAllocationMode] = useState<'manual' | 'random'>('manual')
  const [randomFormat, setRandomFormat] = useState<keyof typeof GAME_FORMATS>('2v2')
  const [randomStrategyId, setRandomStrategyId] = useState(bootstrap.room.defaultSelectionStrategy)
  const [manualAssignments, setManualAssignments] = useState<
    Record<string, 'home' | 'away' | 'bench'>
  >({})
  const [teamAssignmentMode, setTeamAssignmentMode] = useState<'none' | 'manual' | 'random'>('none')
  const [homeTeamCollection, setHomeTeamCollection] = useState<'league' | 'international'>('league')
  const [awayTeamCollection, setAwayTeamCollection] = useState<'league' | 'international'>('league')
  const [homeLeagueId, setHomeLeagueId] = useState<number | 'all'>('all')
  const [awayLeagueId, setAwayLeagueId] = useState<number | 'all'>('all')
  const [manualHomeClubId, setManualHomeClubId] = useState<number | null>(null)
  const [manualAwayClubId, setManualAwayClubId] = useState<number | null>(null)
  const [randomTeamCollection, setRandomTeamCollection] = useState<'all' | 'league' | 'international'>('all')
  const [randomLeagueId, setRandomLeagueId] = useState<number | 'all'>('all')
  const [homeRandomTeamRating, setHomeRandomTeamRating] = useState(8)
  const [awayRandomTeamRating, setAwayRandomTeamRating] = useState(8)

  useEffect(() => {
    setRandomStrategyId(bootstrap.room.defaultSelectionStrategy)
  }, [bootstrap.room.defaultSelectionStrategy])

  useEffect(() => {
    setManualAssignments(buildManualAssignments(bootstrap.currentGame))
  }, [bootstrap.activeGameNight?.id, bootstrap.currentGame])

  const availableRandomFormats = Object.values(GAME_FORMATS).filter(
    (format) => format.size <= activeGameNightGamers.length,
  )
  const internationalClubs = useMemo(
    () => squadClubs.filter((club) => isInternationalClub(club)),
    [squadClubs],
  )
  const homeManualClubOptions = useMemo(
    () => filterTeamOptions(squadClubs, internationalClubs, homeTeamCollection, homeLeagueId),
    [homeLeagueId, homeTeamCollection, internationalClubs, squadClubs],
  )
  const awayManualClubOptions = useMemo(
    () => filterTeamOptions(squadClubs, internationalClubs, awayTeamCollection, awayLeagueId),
    [awayLeagueId, awayTeamCollection, internationalClubs, squadClubs],
  )
  const randomClubPool = useMemo(
    () => filterRandomClubPool(squadClubs, internationalClubs, randomTeamCollection, randomLeagueId),
    [internationalClubs, randomLeagueId, randomTeamCollection, squadClubs],
  )
  const homeRandomClubChoices = useMemo(
    () => randomClubPool.filter((club) => resolveEaTeamStarRating10(null, club.overallRating) === homeRandomTeamRating),
    [homeRandomTeamRating, randomClubPool],
  )
  const awayRandomClubChoices = useMemo(
    () => randomClubPool.filter((club) => resolveEaTeamStarRating10(null, club.overallRating) === awayRandomTeamRating),
    [awayRandomTeamRating, randomClubPool],
  )

  useEffect(() => {
    if (availableRandomFormats.some((format) => format.id === randomFormat)) return
    setRandomFormat(availableRandomFormats.at(-1)?.id ?? '1v1')
  }, [availableRandomFormats, randomFormat])

  const manualHomeIds = Object.entries(manualAssignments)
    .filter(([gamerId, side]) => side === 'home' && activeGameNightGamerIds.has(gamerId))
    .map(([gamerId]) => gamerId)
  const manualAwayIds = Object.entries(manualAssignments)
    .filter(([gamerId, side]) => side === 'away' && activeGameNightGamerIds.has(gamerId))
    .map(([gamerId]) => gamerId)
  const manualFormat = inferGameFormat(manualHomeIds.length, manualAwayIds.length)
  const canCreateManualGame =
    !bootstrap.currentGame &&
    manualFormat !== null &&
    canResolveManualTeams(teamAssignmentMode, manualHomeClubId, manualAwayClubId)
  const canCreateRandomGame =
    !bootstrap.currentGame &&
    availableRandomFormats.length > 0 &&
    canResolveRandomTeams(teamAssignmentMode, homeRandomClubChoices, awayRandomClubChoices)

  function setManualAssignment(gamerId: string, next: 'home' | 'away' | 'bench'): void {
    setManualAssignments((current) => ({
      ...current,
      [gamerId]: next,
    }))
  }

  const randomHomeClub = pickRandomAssignmentClub(homeRandomClubChoices)
  const randomAwayClub = pickRandomAssignmentClub(awayRandomClubChoices, randomHomeClub?.id ?? null)

  return (
    <Panel
      title={bootstrap.currentGame ? 'Game night live' : 'Game creation'}
      subtitle={
        bootstrap.currentGame
          ? 'Track the current matchup, assigned FC teams, result, and optional TV photo.'
          : 'Manual teams infer the format automatically. Random reveals the extra setup.'
      }
    >
      {bootstrap.currentGame ? (
        <CurrentGameCard
          busy={busy}
          currentGame={bootstrap.currentGame}
          gamers={bootstrap.gamers}
          squadClubs={squadClubs}
          onInterruptGame={(request) =>
            bootstrap.activeGameNight
              ? onInterruptGame(
                  bootstrap.activeGameNight.id,
                  bootstrap.currentGame!.id,
                  request,
                )
              : Promise.resolve()
          }
          onRecordGameResult={(request) =>
            bootstrap.activeGameNight
              ? onRecordGameResult(
                  bootstrap.activeGameNight.id,
                  bootstrap.currentGame!.id,
                  request,
                )
              : Promise.resolve()
          }
        />
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
              marginBottom: 14,
            }}
          >
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setAllocationMode('manual')}
              style={allocationMode === 'manual' ? primaryButtonStyle : secondaryButtonStyle}
            >
              Manual
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setAllocationMode('random')}
              style={allocationMode === 'random' ? primaryButtonStyle : secondaryButtonStyle}
            >
              Random
            </button>
          </div>

          <OptionalTeamAssignmentSection
            latestSquadVersion={latestSquadVersion}
            squadLoading={squadLoading}
            teamAssignmentMode={teamAssignmentMode}
            onChangeTeamAssignmentMode={setTeamAssignmentMode}
            leagueOptions={leagueOptions}
            homeTeamCollection={homeTeamCollection}
            awayTeamCollection={awayTeamCollection}
            onChangeHomeTeamCollection={setHomeTeamCollection}
            onChangeAwayTeamCollection={setAwayTeamCollection}
            homeLeagueId={homeLeagueId}
            awayLeagueId={awayLeagueId}
            onChangeHomeLeagueId={setHomeLeagueId}
            onChangeAwayLeagueId={setAwayLeagueId}
            manualHomeClubId={manualHomeClubId}
            manualAwayClubId={manualAwayClubId}
            onChangeManualHomeClubId={setManualHomeClubId}
            onChangeManualAwayClubId={setManualAwayClubId}
            homeManualClubOptions={homeManualClubOptions}
            awayManualClubOptions={awayManualClubOptions}
            randomTeamCollection={randomTeamCollection}
            onChangeRandomTeamCollection={setRandomTeamCollection}
            randomLeagueId={randomLeagueId}
            onChangeRandomLeagueId={setRandomLeagueId}
            homeRandomTeamRating={homeRandomTeamRating}
            awayRandomTeamRating={awayRandomTeamRating}
            onChangeHomeRandomTeamRating={setHomeRandomTeamRating}
            onChangeAwayRandomTeamRating={setAwayRandomTeamRating}
            homeRandomClubChoices={homeRandomClubChoices}
            awayRandomClubChoices={awayRandomClubChoices}
          />

          {allocationMode === 'manual' ? (
            <>
              <div style={{ display: 'grid', gap: 10 }}>
                {activeGameNightGamers.map((gamer) => {
                  const assignment = manualAssignments[gamer.id] ?? 'bench'
                  const homeFull =
                    manualHomeIds.length >= 2 && assignment !== 'home'
                  const awayFull =
                    manualAwayIds.length >= 2 && assignment !== 'away'
                  return (
                    <article
                      key={gamer.id}
                      style={{
                        borderRadius: 18,
                        padding: 14,
                        background: '#ffffff',
                        border: '1px solid #d1fae5',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 10,
                          alignItems: 'center',
                        }}
                      >
                        <GamerIdentity
                          gamer={gamer}
                          size={46}
                          subtitle={
                            assignment === 'bench'
                              ? 'Waiting'
                              : assignment === 'home'
                                ? 'Home side'
                                : 'Away side'
                          }
                        />
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(3, auto)',
                            gap: 8,
                          }}
                        >
                          <button
                            type="button"
                            disabled={busy !== null || homeFull}
                            onClick={() => setManualAssignment(gamer.id, 'home')}
                            style={
                              assignment === 'home'
                                ? primaryButtonStyle
                                : compactButtonStyle
                            }
                          >
                            Home
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null || awayFull}
                            onClick={() => setManualAssignment(gamer.id, 'away')}
                            style={
                              assignment === 'away'
                                ? primaryButtonStyle
                                : compactButtonStyle
                            }
                          >
                            Away
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => setManualAssignment(gamer.id, 'bench')}
                            style={
                              assignment === 'bench'
                                ? secondaryButtonStyle
                                : compactButtonStyle
                            }
                          >
                            Bench
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
              <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
                <div style={{ fontSize: 14, opacity: 0.76 }}>
                  {manualFormat
                    ? `Inferred format: ${GAME_FORMATS[manualFormat].label}`
                    : 'Pick 1 or 2 gamers on each side to create the game.'}
                </div>
                <button
                  type="button"
                  disabled={busy !== null || !canCreateManualGame}
                  onClick={() =>
                    bootstrap.activeGameNight
                      ? void onCreateGame(bootstrap.activeGameNight.id, {
                          allocationMode: 'manual',
                          homeGamerIds: manualHomeIds,
                          awayGamerIds: manualAwayIds,
                          homeClubId: teamAssignmentMode === 'manual' ? manualHomeClubId : null,
                          awayClubId: teamAssignmentMode === 'manual' ? manualAwayClubId : null,
                        })
                      : undefined
                  }
                  style={primaryButtonStyle}
                >
                  {busy === 'creating-game' ? 'Creating game...' : 'Create manual game'}
                </button>
              </div>
            </>
          ) : (
            <>
              <Field label="Format">
                <select
                  value={randomFormat}
                  onChange={(event) =>
                    setRandomFormat(event.target.value as keyof typeof GAME_FORMATS)
                  }
                  style={inputStyle}
                >
                  {availableRandomFormats.map((format) => (
                    <option key={format.id} value={format.id}>
                      {format.label}
                    </option>
                  ))}
                </select>
              </Field>
              {availableRandomFormats.length === 0 ? (
                <InlineNotice
                  tone="warn"
                  message="Add at least 2 active gamers to unlock random allocation."
                />
              ) : null}
              <Field label="Random strategy">
                <select
                  value={randomStrategyId}
                  onChange={(event) => setRandomStrategyId(event.target.value)}
                  style={inputStyle}
                >
                  {strategyOptions.map((strategy) => (
                    <option key={strategy.id} value={strategy.id}>
                      {strategy.displayName}
                    </option>
                  ))}
                </select>
              </Field>
              <p style={{ margin: '0 0 14px', fontSize: 14, opacity: 0.74 }}>
                {strategyOptions.find((strategy) => strategy.id === randomStrategyId)
                  ?.description ?? 'Uses the room default strategy.'}
              </p>
              <button
                type="button"
                disabled={busy !== null || !canCreateRandomGame}
                onClick={() =>
                  bootstrap.activeGameNight
                    ? void onCreateGame(bootstrap.activeGameNight.id, {
                        allocationMode: 'random',
                        format: randomFormat,
                        selectionStrategyId: randomStrategyId,
                        homeClubId: teamAssignmentMode === 'random' ? randomHomeClub?.id ?? null : null,
                        awayClubId: teamAssignmentMode === 'random' ? randomAwayClub?.id ?? null : null,
                      })
                    : undefined
                }
                style={primaryButtonStyle}
              >
                {busy === 'creating-game' ? 'Creating game...' : 'Create random game'}
              </button>
            </>
          )}
        </>
      )}
    </Panel>
  )
}

function OptionalTeamAssignmentSection({
  latestSquadVersion,
  squadLoading,
  teamAssignmentMode,
  onChangeTeamAssignmentMode,
  leagueOptions,
  homeTeamCollection,
  awayTeamCollection,
  onChangeHomeTeamCollection,
  onChangeAwayTeamCollection,
  homeLeagueId,
  awayLeagueId,
  onChangeHomeLeagueId,
  onChangeAwayLeagueId,
  manualHomeClubId,
  manualAwayClubId,
  onChangeManualHomeClubId,
  onChangeManualAwayClubId,
  homeManualClubOptions,
  awayManualClubOptions,
  randomTeamCollection,
  onChangeRandomTeamCollection,
  randomLeagueId,
  onChangeRandomLeagueId,
  homeRandomTeamRating,
  awayRandomTeamRating,
  onChangeHomeRandomTeamRating,
  onChangeAwayRandomTeamRating,
  homeRandomClubChoices,
  awayRandomClubChoices,
}: {
  latestSquadVersion: string | null
  squadLoading: boolean
  teamAssignmentMode: 'none' | 'manual' | 'random'
  onChangeTeamAssignmentMode: (value: 'none' | 'manual' | 'random') => void
  leagueOptions: ReadonlyArray<SquadLeague>
  homeTeamCollection: 'league' | 'international'
  awayTeamCollection: 'league' | 'international'
  onChangeHomeTeamCollection: (value: 'league' | 'international') => void
  onChangeAwayTeamCollection: (value: 'league' | 'international') => void
  homeLeagueId: number | 'all'
  awayLeagueId: number | 'all'
  onChangeHomeLeagueId: (value: number | 'all') => void
  onChangeAwayLeagueId: (value: number | 'all') => void
  manualHomeClubId: number | null
  manualAwayClubId: number | null
  onChangeManualHomeClubId: (value: number | null) => void
  onChangeManualAwayClubId: (value: number | null) => void
  homeManualClubOptions: ReadonlyArray<Club>
  awayManualClubOptions: ReadonlyArray<Club>
  randomTeamCollection: 'all' | 'league' | 'international'
  onChangeRandomTeamCollection: (value: 'all' | 'league' | 'international') => void
  randomLeagueId: number | 'all'
  onChangeRandomLeagueId: (value: number | 'all') => void
  homeRandomTeamRating: number
  awayRandomTeamRating: number
  onChangeHomeRandomTeamRating: (value: number) => void
  onChangeAwayRandomTeamRating: (value: number) => void
  homeRandomClubChoices: ReadonlyArray<Club>
  awayRandomClubChoices: ReadonlyArray<Club>
}) {
  return (
    <div
      style={{
        marginBottom: 14,
        padding: 14,
        borderRadius: 18,
        background: '#ffffff',
        border: '1px solid #d1fae5',
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ display: 'grid', gap: 4 }}>
        <strong style={{ fontSize: 16 }}>Optional FC teams</strong>
        <span style={{ fontSize: 13, opacity: 0.72 }}>
          Assign club or international teams to the matchup. This uses the latest retrieved squad data.
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => onChangeTeamAssignmentMode('none')} style={teamAssignmentMode === 'none' ? primaryButtonStyle : compactButtonStyle}>No FC teams</button>
        <button type="button" onClick={() => onChangeTeamAssignmentMode('manual')} style={teamAssignmentMode === 'manual' ? primaryButtonStyle : compactButtonStyle}>Pick FC teams</button>
        <button type="button" onClick={() => onChangeTeamAssignmentMode('random')} style={teamAssignmentMode === 'random' ? primaryButtonStyle : compactButtonStyle}>FC teams by stars</button>
      </div>
      {!latestSquadVersion ? (
        <InlineNotice tone="warn" message="Retrieve squad data in Settings before assigning FC teams." />
      ) : squadLoading ? (
        <InlineNotice tone="info" message="Loading FC teams..." />
      ) : teamAssignmentMode === 'manual' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
          <ManualTeamPicker
            title="Home FC team"
            collection={homeTeamCollection}
            onChangeCollection={onChangeHomeTeamCollection}
            leagueId={homeLeagueId}
            onChangeLeagueId={onChangeHomeLeagueId}
            selectedClubId={manualHomeClubId}
            onChangeClubId={onChangeManualHomeClubId}
            leagueOptions={leagueOptions}
            clubs={homeManualClubOptions}
          />
          <ManualTeamPicker
            title="Away FC team"
            collection={awayTeamCollection}
            onChangeCollection={onChangeAwayTeamCollection}
            leagueId={awayLeagueId}
            onChangeLeagueId={onChangeAwayLeagueId}
            selectedClubId={manualAwayClubId}
            onChangeClubId={onChangeManualAwayClubId}
            leagueOptions={leagueOptions}
            clubs={awayManualClubOptions}
          />
        </div>
      ) : teamAssignmentMode === 'random' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => onChangeRandomTeamCollection('all')} style={randomTeamCollection === 'all' ? primaryButtonStyle : compactButtonStyle}>Any team</button>
            <button type="button" onClick={() => onChangeRandomTeamCollection('league')} style={randomTeamCollection === 'league' ? primaryButtonStyle : compactButtonStyle}>Within league</button>
            <button type="button" onClick={() => onChangeRandomTeamCollection('international')} style={randomTeamCollection === 'international' ? primaryButtonStyle : compactButtonStyle}>International</button>
          </div>
          {randomTeamCollection === 'league' ? (
            <Field label="League filter">
              <select
                value={String(randomLeagueId)}
                onChange={(event) => onChangeRandomLeagueId(event.target.value === 'all' ? 'all' : Number.parseInt(event.target.value, 10))}
                style={inputStyle}
              >
                <option value="all">All leagues</option>
                {leagueOptions.map((league) => (
                  <option key={league.id} value={league.id}>{league.name}</option>
                ))}
              </select>
            </Field>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
            <div style={{ display: 'grid', gap: 10 }}>
              <RatingSelector label="Home team stars" value={homeRandomTeamRating} onChange={onChangeHomeRandomTeamRating} />
              <ClubMatchPreview clubs={homeRandomClubChoices} emptyMessage="No home-team matches for this star rating." />
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <RatingSelector label="Away team stars" value={awayRandomTeamRating} onChange={onChangeAwayRandomTeamRating} />
              <ClubMatchPreview clubs={awayRandomClubChoices} emptyMessage="No away-team matches for this star rating." />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ManualTeamPicker({
  title,
  collection,
  onChangeCollection,
  leagueId,
  onChangeLeagueId,
  selectedClubId,
  onChangeClubId,
  leagueOptions,
  clubs,
}: {
  title: string
  collection: 'league' | 'international'
  onChangeCollection: (value: 'league' | 'international') => void
  leagueId: number | 'all'
  onChangeLeagueId: (value: number | 'all') => void
  selectedClubId: number | null
  onChangeClubId: (value: number | null) => void
  leagueOptions: ReadonlyArray<SquadLeague>
  clubs: ReadonlyArray<Club>
}) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <strong style={{ fontSize: 14 }}>{title}</strong>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => onChangeCollection('league')} style={collection === 'league' ? primaryButtonStyle : compactButtonStyle}>League</button>
        <button type="button" onClick={() => onChangeCollection('international')} style={collection === 'international' ? primaryButtonStyle : compactButtonStyle}>International</button>
      </div>
      {collection === 'league' ? (
        <Field label="League">
          <select
            value={String(leagueId)}
            onChange={(event) => onChangeLeagueId(event.target.value === 'all' ? 'all' : Number.parseInt(event.target.value, 10))}
            style={inputStyle}
          >
            <option value="all">All leagues</option>
            {leagueOptions.map((league) => (
              <option key={league.id} value={league.id}>{league.name}</option>
            ))}
          </select>
        </Field>
      ) : null}
      <ClubScroller clubs={clubs} selectedClubId={selectedClubId} onChangeClubId={onChangeClubId} />
    </div>
  )
}

function ClubScroller({
  clubs,
  selectedClubId,
  onChangeClubId,
}: {
  clubs: ReadonlyArray<Club>
  selectedClubId: number | null
  onChangeClubId: (value: number | null) => void
}) {
  if (clubs.length === 0) {
    return <InlineNotice tone="info" message="No FC teams match this filter." />
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        paddingBottom: 4,
      }}
    >
      {clubs.map((club) => {
        const star10 = resolveEaTeamStarRating10(null, club.overallRating)
        return (
          <button
            key={club.id}
            type="button"
            onClick={() => onChangeClubId(club.id)}
            style={{
              minWidth: 150,
              textAlign: 'left',
              borderRadius: 16,
              padding: 10,
              background: selectedClubId === club.id ? '#ecfdf5' : '#ffffff',
              border: `1px solid ${selectedClubId === club.id ? '#22c55e' : '#d1fae5'}`,
              color: '#052e16',
              display: 'grid',
              gap: 6,
            }}
          >
            <strong style={{ fontSize: 14, lineHeight: 1.15 }}>{club.name}</strong>
            <span style={{ fontSize: 12, opacity: 0.72 }}>{club.leagueName}</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <StarRow rating10={star10 ?? 0} />
              <span style={{ fontSize: 12, opacity: 0.72 }}>OVR {club.overallRating}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function ClubMatchPreview({
  clubs,
  emptyMessage,
}: {
  clubs: ReadonlyArray<Club>
  emptyMessage: string
}) {
  if (clubs.length === 0) {
    return <InlineNotice tone="warn" message={emptyMessage} />
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <span style={{ fontSize: 13, opacity: 0.72 }}>
        Matching teams: {clubs.length}
      </span>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {clubs.slice(0, 8).map((club) => (
          <div
            key={club.id}
            style={{
              minWidth: 140,
              borderRadius: 14,
              padding: 10,
              background: '#f8fafc',
              border: '1px solid #d1fae5',
              color: '#052e16',
              display: 'grid',
              gap: 4,
            }}
          >
            <strong style={{ fontSize: 13, lineHeight: 1.15 }}>{club.name}</strong>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{club.leagueName}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function isInternationalClub(club: Club): boolean {
  return /international|national/i.test(club.leagueName)
}

function filterTeamOptions(
  clubs: ReadonlyArray<Club>,
  internationalClubs: ReadonlyArray<Club>,
  collection: 'league' | 'international',
  leagueId: number | 'all',
): ReadonlyArray<Club> {
  if (collection === 'international') return internationalClubs
  return clubs.filter((club) => (leagueId === 'all' ? !isInternationalClub(club) : club.leagueId === leagueId))
}

function filterRandomClubPool(
  clubs: ReadonlyArray<Club>,
  internationalClubs: ReadonlyArray<Club>,
  collection: 'all' | 'league' | 'international',
  leagueId: number | 'all',
): ReadonlyArray<Club> {
  if (collection === 'international') return internationalClubs
  if (collection === 'league') {
    return clubs.filter((club) => (leagueId === 'all' ? !isInternationalClub(club) : club.leagueId === leagueId))
  }
  return clubs
}

function canResolveManualTeams(
  teamAssignmentMode: 'none' | 'manual' | 'random',
  homeClubId: number | null,
  awayClubId: number | null,
): boolean {
  if (teamAssignmentMode !== 'manual') return true
  return homeClubId !== null && awayClubId !== null
}

function canResolveRandomTeams(
  teamAssignmentMode: 'none' | 'manual' | 'random',
  homeChoices: ReadonlyArray<Club>,
  awayChoices: ReadonlyArray<Club>,
): boolean {
  if (teamAssignmentMode !== 'random') return true
  return homeChoices.length > 0 && awayChoices.length > 0
}

function pickRandomAssignmentClub(
  clubs: ReadonlyArray<Club>,
  blockedClubId: number | null = null,
): Club | null {
  const preferred =
    blockedClubId === null
      ? clubs[0]
      : clubs.find((club) => club.id !== blockedClubId)

  return preferred ?? clubs[0] ?? null
}
