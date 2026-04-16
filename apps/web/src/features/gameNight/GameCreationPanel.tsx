import { useEffect, useMemo, useState } from 'react'
import {
  type Club,
  type CreateCurrentGameRequest,
  GAME_FORMATS,
  type Gamer,
  type AnalysePhotoResponse,
  type InterruptCurrentGameRequest,
  type RecordCurrentGameResultRequest,
  type RoomBootstrapResponse,
  inferGameFormat,
  listStrategies,
} from '@fc26/shared'
import { EaTeamCard } from '../../components/EaTeamCard.jsx'
import { EmptyTeamCard } from '../../components/EmptyTeamCard.jsx'
import { GamerIdentity } from '../../components/GamerPanel.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { Panel } from '../../components/Panel.jsx'
import {
  compactButtonStyle,
  inputStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'
import type { SquadBrowserState } from '../squads/useSquadBrowser.js'
import { buildManualAssignments } from '../../utils/roster.js'
import { CurrentGameCard } from './CurrentGameCard.jsx'
import { InlineTeamPicker } from './InlineTeamPicker.jsx'
import { Field } from '../../components/Field.jsx'

// ---------------------------------------------------------------------------
// localStorage helpers for last-used club persistence
// ---------------------------------------------------------------------------

function lastClubKey(roomId: string, side: 'home' | 'away'): string {
  return `fc26:room:${roomId}:last-${side}-club-id`
}

function teamBrowserStateKey(roomId: string): string {
  return `fc26:room:${roomId}:team-browser-state`
}

function loadLastClubId(roomId: string, side: 'home' | 'away'): number | null {
  try {
    const raw = localStorage.getItem(lastClubKey(roomId, side))
    if (raw === null) return null
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

function saveLastClubId(roomId: string, side: 'home' | 'away', clubId: number): void {
  try {
    localStorage.setItem(lastClubKey(roomId, side), String(clubId))
  } catch {
    // Silently ignore quota / security errors.
  }
}

interface PersistedBrowserState {
  gender: 'men' | 'women'
  countryNationId: number | null
  leagueId: number | null
}

function loadBrowserState(roomId: string): PersistedBrowserState | null {
  try {
    const raw = localStorage.getItem(teamBrowserStateKey(roomId))
    if (!raw) return null
    return JSON.parse(raw) as PersistedBrowserState
  } catch {
    return null
  }
}

function saveBrowserState(roomId: string, state: PersistedBrowserState): void {
  try {
    localStorage.setItem(teamBrowserStateKey(roomId), JSON.stringify(state))
  } catch {
    // Silently ignore quota / security errors.
  }
}

// ---------------------------------------------------------------------------
// GameCreationPanel
// ---------------------------------------------------------------------------

export function GameCreationPanel({
  bootstrap,
  busy,
  activeGameNightGamers,
  activeGameNightGamerIds,
  latestSquadVersion,
  squadClubs,
  squadLoading,
  squadBrowserTeams,
  onCreateGame,
  onInterruptGame,
  onRecordGameResult,
  onAnalysePhoto,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  activeGameNightGamers: ReadonlyArray<Gamer>
  activeGameNightGamerIds: ReadonlySet<string>
  latestSquadVersion: string | null
  squadClubs: ReadonlyArray<Club>
  squadLoading: boolean
  squadBrowserTeams: SquadBrowserState['teams']
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
  onAnalysePhoto: (
    gameNightId: string,
    gameId: string,
    image: string,
  ) => Promise<AnalysePhotoResponse>
}) {
  const strategyOptions = useMemo(() => listStrategies(), [])
  const [allocationMode, setAllocationMode] = useState<'manual' | 'random'>('manual')
  const [randomFormat, setRandomFormat] = useState<keyof typeof GAME_FORMATS>('2v2')
  const [randomStrategyId, setRandomStrategyId] = useState(bootstrap.room.defaultSelectionStrategy)
  const [manualAssignments, setManualAssignments] = useState<
    Record<string, 'home' | 'away' | 'bench'>
  >({})
  const [teamAssignmentMode, setTeamAssignmentMode] = useState<'none' | 'pick'>('none')
  const [manualHomeClubId, setManualHomeClubId] = useState<number | null>(null)
  const [manualAwayClubId, setManualAwayClubId] = useState<number | null>(null)
  const [pickingSide, setPickingSide] = useState<'home' | 'away' | null>(null)

  const roomId = bootstrap.room.id

  // Load last-used club IDs and browser state from localStorage on mount.
  useEffect(() => {
    const savedHome = loadLastClubId(roomId, 'home')
    const savedAway = loadLastClubId(roomId, 'away')
    if (savedHome !== null) setManualHomeClubId(savedHome)
    if (savedAway !== null) setManualAwayClubId(savedAway)

    const savedBrowser = loadBrowserState(roomId)
    if (savedBrowser) {
      squadBrowserTeams.setGender(savedBrowser.gender)
      squadBrowserTeams.setCountryNationId(savedBrowser.countryNationId)
      if (savedBrowser.leagueId !== null) {
        squadBrowserTeams.setSelectedLeagueId(savedBrowser.leagueId)
      }
    }
    // Only run on mount — roomId won't change within a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  useEffect(() => {
    setRandomStrategyId(bootstrap.room.defaultSelectionStrategy)
  }, [bootstrap.room.defaultSelectionStrategy])

  useEffect(() => {
    setManualAssignments(buildManualAssignments(bootstrap.currentGame))
  }, [bootstrap.activeGameNight?.id, bootstrap.currentGame])

  const availableRandomFormats = Object.values(GAME_FORMATS).filter(
    (format) => format.size <= activeGameNightGamers.length,
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
    (teamAssignmentMode !== 'pick' || (manualHomeClubId !== null && manualAwayClubId !== null))

  const canCreateRandomGame =
    !bootstrap.currentGame && availableRandomFormats.length > 0

  // Resolve Club objects for displaying selected team cards.
  const homeClub = useMemo(
    () => (manualHomeClubId !== null ? squadClubs.find((c) => c.id === manualHomeClubId) ?? null : null),
    [manualHomeClubId, squadClubs],
  )
  const awayClub = useMemo(
    () => (manualAwayClubId !== null ? squadClubs.find((c) => c.id === manualAwayClubId) ?? null : null),
    [manualAwayClubId, squadClubs],
  )

  // Gamer names by side for the inline picker title.
  const homeGamerNames = manualHomeIds
    .map((id) => activeGameNightGamers.find((g) => g.id === id)?.name)
    .filter((n): n is string => n !== undefined)
  const awayGamerNames = manualAwayIds
    .map((id) => activeGameNightGamers.find((g) => g.id === id)?.name)
    .filter((n): n is string => n !== undefined)

  function setManualAssignment(gamerId: string, next: 'home' | 'away' | 'bench'): void {
    setManualAssignments((current) => ({
      ...current,
      [gamerId]: next,
    }))
  }

  function handleSelectClub(club: Club): void {
    if (pickingSide === 'home') {
      setManualHomeClubId(club.id)
      saveLastClubId(roomId, 'home', club.id)
    } else if (pickingSide === 'away') {
      setManualAwayClubId(club.id)
      saveLastClubId(roomId, 'away', club.id)
    }
    // Persist browser state so the next pick (other side) keeps the same filters.
    saveBrowserState(roomId, {
      gender: squadBrowserTeams.gender,
      countryNationId: squadBrowserTeams.countryNationId,
      leagueId: squadBrowserTeams.selectedLeagueId,
    })
    setPickingSide(null)
  }

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
          onAnalysePhoto={(image) =>
            bootstrap.activeGameNight
              ? onAnalysePhoto(
                  bootstrap.activeGameNight.id,
                  bootstrap.currentGame!.id,
                  image,
                )
              : Promise.reject(new Error('No active game night'))
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

          <TeamAssignmentSection
            latestSquadVersion={latestSquadVersion}
            squadLoading={squadLoading}
            teamAssignmentMode={teamAssignmentMode}
            onChangeTeamAssignmentMode={(mode) => {
              setTeamAssignmentMode(mode)
              setPickingSide(null)
            }}
            homeClub={homeClub}
            awayClub={awayClub}
            pickingSide={pickingSide}
            onClickCard={(side) => setPickingSide(side)}
            homeGamerNames={homeGamerNames}
            awayGamerNames={awayGamerNames}
            squadBrowserTeams={squadBrowserTeams}
            onSelectClub={handleSelectClub}
            onCancelPicker={() => setPickingSide(null)}
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
                          flexWrap: 'wrap',
                          gap: 8,
                          alignItems: 'center',
                        }}
                      >
                        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                          <GamerIdentity
                            gamer={gamer}
                            size={40}
                            subtitle={
                              assignment === 'bench'
                                ? 'Waiting'
                                : assignment === 'home'
                                  ? 'Home side'
                                  : 'Away side'
                            }
                          />
                        </div>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(3, auto)',
                            gap: 6,
                            flexShrink: 0,
                          }}
                        >
                          <button
                            type="button"
                            disabled={busy !== null || homeFull}
                            onClick={() => setManualAssignment(gamer.id, 'home')}
                            style={
                              assignment === 'home'
                                ? { ...primaryButtonStyle, padding: '8px 12px', fontSize: 13 }
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
                                ? { ...primaryButtonStyle, padding: '8px 12px', fontSize: 13 }
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
                                ? { ...secondaryButtonStyle, padding: '8px 12px', fontSize: 13 }
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
                          homeClubId: teamAssignmentMode === 'pick' ? manualHomeClubId : null,
                          awayClubId: teamAssignmentMode === 'pick' ? manualAwayClubId : null,
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
                        homeClubId: teamAssignmentMode === 'pick' ? manualHomeClubId : null,
                        awayClubId: teamAssignmentMode === 'pick' ? manualAwayClubId : null,
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

// ---------------------------------------------------------------------------
// TeamAssignmentSection — replaces the old OptionalTeamAssignmentSection
// ---------------------------------------------------------------------------

function TeamAssignmentSection({
  latestSquadVersion,
  squadLoading,
  teamAssignmentMode,
  onChangeTeamAssignmentMode,
  homeClub,
  awayClub,
  pickingSide,
  onClickCard,
  homeGamerNames,
  awayGamerNames,
  squadBrowserTeams,
  onSelectClub,
  onCancelPicker,
}: {
  latestSquadVersion: string | null
  squadLoading: boolean
  teamAssignmentMode: 'none' | 'pick'
  onChangeTeamAssignmentMode: (value: 'none' | 'pick') => void
  homeClub: Club | null
  awayClub: Club | null
  pickingSide: 'home' | 'away' | null
  onClickCard: (side: 'home' | 'away') => void
  homeGamerNames: string[]
  awayGamerNames: string[]
  squadBrowserTeams: SquadBrowserState['teams']
  onSelectClub: (club: Club) => void
  onCancelPicker: () => void
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
        <button
          type="button"
          onClick={() => onChangeTeamAssignmentMode('none')}
          style={teamAssignmentMode === 'none' ? primaryButtonStyle : compactButtonStyle}
        >
          No FC teams
        </button>
        <button
          type="button"
          onClick={() => onChangeTeamAssignmentMode('pick')}
          style={teamAssignmentMode === 'pick' ? primaryButtonStyle : compactButtonStyle}
        >
          Pick FC teams
        </button>
      </div>

      {!latestSquadVersion ? (
        <InlineNotice tone="warn" message="Retrieve squad data in Settings before assigning FC teams." />
      ) : squadLoading ? (
        <InlineNotice tone="info" message="Loading FC teams..." />
      ) : teamAssignmentMode === 'pick' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {/* Two-column side-by-side team cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 12,
            }}
          >
            {/* Home card */}
            <div style={{ display: 'grid', gap: 6 }}>
              <strong
                style={{
                  fontSize: 14,
                  fontFamily: 'Georgia, serif',
                  color: '#166534',
                  textAlign: 'center',
                }}
              >
                Home
              </strong>
              {homeClub ? (
                <EaTeamCard
                  club={homeClub}
                  size="medium"
                  selected={pickingSide === 'home'}
                  onSelect={() => onClickCard('home')}
                />
              ) : (
                <EmptyTeamCard onClick={() => onClickCard('home')} />
              )}
            </div>

            {/* Away card */}
            <div style={{ display: 'grid', gap: 6 }}>
              <strong
                style={{
                  fontSize: 14,
                  fontFamily: 'Georgia, serif',
                  color: '#166534',
                  textAlign: 'center',
                }}
              >
                Away
              </strong>
              {awayClub ? (
                <EaTeamCard
                  club={awayClub}
                  size="medium"
                  selected={pickingSide === 'away'}
                  onSelect={() => onClickCard('away')}
                />
              ) : (
                <EmptyTeamCard onClick={() => onClickCard('away')} />
              )}
            </div>
          </div>

          {/* Inline team picker shown below the cards */}
          {pickingSide !== null ? (
            <InlineTeamPicker
              side={pickingSide}
              gamerNames={pickingSide === 'home' ? homeGamerNames : awayGamerNames}
              squadBrowserTeams={squadBrowserTeams}
              onSelect={onSelectClub}
              onCancel={onCancelPicker}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
