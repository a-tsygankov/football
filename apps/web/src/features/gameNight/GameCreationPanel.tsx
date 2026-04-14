import { useEffect, useMemo, useState } from 'react'
import {
  type CreateCurrentGameRequest,
  GAME_FORMATS,
  type Gamer,
  type InterruptCurrentGameRequest,
  type RecordCurrentGameResultRequest,
  type RoomBootstrapResponse,
  inferGameFormat,
  listStrategies,
} from '@fc26/shared'
import { Field } from '../../components/Field.jsx'
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
import { buildManualAssignments } from '../../utils/roster.js'
import { CurrentGameCard } from './CurrentGameCard.jsx'

export function GameCreationPanel({
  bootstrap,
  busy,
  activeGameNightGamers,
  activeGameNightGamerIds,
  hasUnsavedActiveGamers,
  onCreateGame,
  onInterruptGame,
  onRecordGameResult,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  activeGameNightGamers: ReadonlyArray<Gamer>
  activeGameNightGamerIds: ReadonlySet<string>
  hasUnsavedActiveGamers: boolean
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
  const [allocationMode, setAllocationMode] = useState<'manual' | 'random'>('manual')
  const [randomFormat, setRandomFormat] = useState<keyof typeof GAME_FORMATS>('2v2')
  const [randomStrategyId, setRandomStrategyId] = useState(bootstrap.room.defaultSelectionStrategy)
  const [manualAssignments, setManualAssignments] = useState<
    Record<string, 'home' | 'away' | 'bench'>
  >({})

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
    !bootstrap.currentGame && !hasUnsavedActiveGamers && manualFormat !== null
  const canCreateRandomGame =
    !bootstrap.currentGame && !hasUnsavedActiveGamers && availableRandomFormats.length > 0

  function setManualAssignment(gamerId: string, next: 'home' | 'away' | 'bench'): void {
    setManualAssignments((current) => ({
      ...current,
      [gamerId]: next,
    }))
  }

  return (
    <Panel
      title="Game creation"
      subtitle="Manual teams infer the format automatically. Random reveals the extra setup."
    >
      {bootstrap.currentGame ? (
        <CurrentGameCard
          busy={busy}
          currentGame={bootstrap.currentGame}
          gamers={bootstrap.gamers}
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

          {hasUnsavedActiveGamers ? (
            <div
              style={{
                marginBottom: 14,
                padding: 12,
                borderRadius: 16,
                background: '#fffbeb',
                border: '1px solid #fcd34d',
                fontSize: 14,
              }}
            >
              Save the live pool before creating the next game.
            </div>
          ) : null}

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
