import { useEffect, useMemo, useState } from 'react'
import type {
  CreateCurrentGameRequest,
  Gamer,
  InterruptCurrentGameRequest,
  RecordCurrentGameResultRequest,
  RoomBootstrapResponse,
  RoomScoreboardResponse,
  SquadPlatform,
  UpdateGamerRequest,
} from '@fc26/shared'
import { AddGamerPanel } from '../gamers/AddGamerPanel.jsx'
import { RosterPanel } from '../gamers/RosterPanel.jsx'
import { GameCreationPanel } from '../gameNight/GameCreationPanel.jsx'
import { GameNightRosterPanel } from '../gameNight/GameNightRosterPanel.jsx'
import { StartGameNightPanel } from '../gameNight/StartGameNightPanel.jsx'
import { ScoreboardPanel } from '../scoreboard/ScoreboardPanel.jsx'
import { ChangesPanel } from '../squads/ChangesPanel.jsx'
import { TeamsPanel } from '../squads/TeamsPanel.jsx'
import { useSquadBrowser } from '../squads/useSquadBrowser.js'
import { ActiveRoomHeader } from './ActiveRoomHeader.jsx'
import { SettingsPanel } from './SettingsPanel.jsx'
import type { BusyState } from '../../types/busyState.js'
import { sameIds } from '../../utils/roster.js'

export function RoomScreen({
  bootstrap,
  busy,
  latestSquadVersion,
  roomSquadPlatform,
  scoreboard,
  gamerName,
  gamerRating,
  gamerPin,
  gamerAvatarUrl,
  onChangeGamerName,
  onChangeGamerPin,
  onChangeGamerRating,
  onChangeGamerAvatar,
  onCreateGamer,
  onCreateGame,
  onInterruptGame,
  onLeaveRoom,
  onRecordGameResult,
  onRefresh,
  onResetSquadData,
  onRetrieveSquadData,
  onRefreshSquadAssets,
  onSaveRoomSettings,
  onChangeRoomSquadPlatform,
  onSaveActiveGameNightGamers,
  onStartGameNight,
  onToggleGamer,
  onUpdateGamerDetails,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  latestSquadVersion: string | null
  roomSquadPlatform: SquadPlatform
  scoreboard: RoomScoreboardResponse | null
  gamerName: string
  gamerRating: string
  gamerPin: string
  gamerAvatarUrl: string | null
  onChangeGamerName: (value: string) => void
  onChangeGamerPin: (value: string) => void
  onChangeGamerRating: (value: string) => void
  onChangeGamerAvatar: (value: string | null) => void
  onCreateGamer: () => Promise<void>
  onCreateGame: (gameNightId: string, request: CreateCurrentGameRequest) => Promise<void>
  onInterruptGame: (
    gameNightId: string,
    gameId: string,
    request: InterruptCurrentGameRequest,
  ) => Promise<void>
  onLeaveRoom: () => void
  onRecordGameResult: (
    gameNightId: string,
    gameId: string,
    request: RecordCurrentGameResultRequest,
  ) => Promise<void>
  onRefresh: () => Promise<void>
  onResetSquadData: () => Promise<void>
  onRetrieveSquadData: () => Promise<void>
  onRefreshSquadAssets: () => Promise<void>
  onSaveRoomSettings: () => Promise<void>
  onChangeRoomSquadPlatform: (value: SquadPlatform) => void
  onSaveActiveGameNightGamers: (
    gameNightId: string,
    activeGamerIds: string[],
  ) => Promise<void>
  onStartGameNight: () => Promise<void>
  onToggleGamer: (gamer: Gamer) => Promise<void>
  onUpdateGamerDetails: (gamerId: string, request: UpdateGamerRequest) => Promise<void>
}) {
  const activeGameNightGamerIds = useMemo(
    () => new Set<string>(bootstrap.activeGameNightGamers.map((item) => item.gamerId)),
    [bootstrap.activeGameNightGamers],
  )
  const currentGameGamerIds = useMemo(
    () =>
      new Set<string>([
        ...(bootstrap.currentGame?.homeGamerIds ?? []),
        ...(bootstrap.currentGame?.awayGamerIds ?? []),
      ]),
    [bootstrap.currentGame],
  )
  const [draftActiveGamerIds, setDraftActiveGamerIds] = useState<string[]>([])
  const activeRoomGamers = bootstrap.gamers.filter((gamer) => gamer.active)
  const activeGameNightGamers = bootstrap.activeGameNightGamers
    .map((item) => bootstrap.gamers.find((gamer) => gamer.id === item.gamerId))
    .filter((gamer): gamer is Gamer => gamer !== undefined)
  const hasUnsavedActiveGamers = !sameIds(
    draftActiveGamerIds,
    bootstrap.activeGameNightGamers.map((item) => item.gamerId),
  )
  const squadBrowser = useSquadBrowser(latestSquadVersion)

  useEffect(() => {
    setDraftActiveGamerIds(bootstrap.activeGameNightGamers.map((item) => item.gamerId))
  }, [bootstrap.activeGameNightGamers])

  function toggleActiveGamerDraft(gamerId: string): void {
    if (currentGameGamerIds.has(gamerId)) return
    setDraftActiveGamerIds((current) =>
      current.includes(gamerId)
        ? current.filter((item) => item !== gamerId)
        : [...current, gamerId],
    )
  }

  return (
    <>
      <ActiveRoomHeader
        bootstrap={bootstrap}
        busy={busy}
        onLeaveRoom={onLeaveRoom}
        onRefresh={onRefresh}
      />

      <section
        id="fc26-game-section"
        style={{
          marginTop: 18,
          display: 'grid',
          gap: 14,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        <StartGameNightPanel
          bootstrap={bootstrap}
          busy={busy}
          onStartGameNight={onStartGameNight}
        />
        <AddGamerPanel
          bootstrap={bootstrap}
          busy={busy}
          gamerName={gamerName}
          gamerRating={gamerRating}
          gamerPin={gamerPin}
          gamerAvatarUrl={gamerAvatarUrl}
          onChangeGamerName={onChangeGamerName}
          onChangeGamerPin={onChangeGamerPin}
          onChangeGamerRating={onChangeGamerRating}
          onChangeGamerAvatar={onChangeGamerAvatar}
          onCreateGamer={onCreateGamer}
        />
      </section>

      {bootstrap.activeGameNight ? (
        <section
          style={{
            marginTop: 18,
            display: 'grid',
            gap: 14,
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          }}
        >
          <GameNightRosterPanel
            bootstrap={bootstrap}
            busy={busy}
            activeRoomGamers={activeRoomGamers}
            currentGameGamerIds={currentGameGamerIds}
            draftActiveGamerIds={draftActiveGamerIds}
            hasUnsavedActiveGamers={hasUnsavedActiveGamers}
            onToggleDraftGamer={toggleActiveGamerDraft}
            onSaveActiveGameNightGamers={onSaveActiveGameNightGamers}
          />
          <GameCreationPanel
            bootstrap={bootstrap}
            busy={busy}
            activeGameNightGamers={activeGameNightGamers}
            activeGameNightGamerIds={activeGameNightGamerIds}
            hasUnsavedActiveGamers={hasUnsavedActiveGamers}
            onCreateGame={onCreateGame}
            onInterruptGame={onInterruptGame}
            onRecordGameResult={onRecordGameResult}
          />
        </section>
      ) : null}

      <ScoreboardPanel scoreboard={scoreboard} />

      <TeamsPanel
        latestSquadVersion={latestSquadVersion}
        roomSquadPlatform={roomSquadPlatform}
        squadPanelError={squadBrowser.squadPanelError}
        squadVersions={squadBrowser.squadVersions}
        teams={squadBrowser.teams}
      />

      <ChangesPanel
        latestSquadVersion={latestSquadVersion}
        squadVersions={squadBrowser.squadVersions}
        squadPanelError={squadBrowser.squadPanelError}
        changes={squadBrowser.changes}
      />

      <SettingsPanel
        bootstrap={bootstrap}
        busy={busy}
        latestSquadVersion={latestSquadVersion}
        roomSquadPlatform={roomSquadPlatform}
        onChangeRoomSquadPlatform={onChangeRoomSquadPlatform}
        onRefreshSquadAssets={onRefreshSquadAssets}
        onResetSquadData={onResetSquadData}
        onRetrieveSquadData={onRetrieveSquadData}
        onSaveRoomSettings={onSaveRoomSettings}
      />

      <RosterPanel
        bootstrap={bootstrap}
        busy={busy}
        activeGameNightGamerIds={activeGameNightGamerIds}
        currentGameGamerIds={currentGameGamerIds}
        onToggleGamer={onToggleGamer}
        onUpdateGamerDetails={onUpdateGamerDetails}
      />
    </>
  )
}
