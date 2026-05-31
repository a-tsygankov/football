import { useEffect, useMemo, useState } from 'react'
import type {
  AnalysePhotoResponse,
  CreateCurrentGameRequest,
  Gamer,
  InterruptCurrentGameRequest,
  MatchHistoryResponse,
  MatchHistoryScope,
  RecordCurrentGameResultRequest,
  RoomBootstrapResponse,
  RoomScoreboardResponse,
  SquadPlatform,
  UpdateGamerRequest,
} from '@fc26/shared'
import { useDebugConsole } from '../../debug/console-store.js'
import { RosterPanel } from '../gamers/RosterPanel.jsx'
import { GameCreationPanel } from '../gameNight/GameCreationPanel.jsx'
import { StartGameNightPanel } from '../gameNight/StartGameNightPanel.jsx'
import { ScoreboardPanel } from '../scoreboard/ScoreboardPanel.jsx'
import { TeamsPanel } from '../squads/TeamsPanel.jsx'
import { useSquadBrowser } from '../squads/useSquadBrowser.js'
import { ActiveRoomHeader } from './ActiveRoomHeader.jsx'
import { SettingsPanel } from './SettingsPanel.jsx'
import type { BusyState } from '../../types/busyState.js'

export function RoomScreen({
  bootstrap,
  busy,
  latestSquadVersion,
  roomSquadPlatform,
  scoreboard,
  onLoadMatchHistory,
  onVoidGame,
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
  onAnalysePhoto,
  onRefresh,
  onRepairSquads,
  onResetSquadData,
  onRetrieveSquadData,
  onRefreshSquadAssets,
  onSaveRoomSettings,
  onChangeRoomSquadPlatform,
  onStartGameNight,
  onToggleGamer,
  onUpdateGamerDetails,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  latestSquadVersion: string | null
  roomSquadPlatform: SquadPlatform
  scoreboard: RoomScoreboardResponse | null
  onLoadMatchHistory: (scope: MatchHistoryScope) => Promise<MatchHistoryResponse>
  onVoidGame: (gameNightId: string, gameId: string) => Promise<void>
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
  onAnalysePhoto: (
    gameNightId: string,
    gameId: string,
    image: string,
    homeTeam?: { name: string; aliases: string[] } | null,
    awayTeam?: { name: string; aliases: string[] } | null,
  ) => Promise<AnalysePhotoResponse>
  onRefresh: () => Promise<void>
  onRepairSquads: () => Promise<void>
  onResetSquadData: () => Promise<void>
  onRetrieveSquadData: () => Promise<void>
  onRefreshSquadAssets: (mode?: 'soft' | 'hard') => Promise<void>
  onSaveRoomSettings: () => Promise<void>
  onChangeRoomSquadPlatform: (value: SquadPlatform) => void
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
  const activeGameNightGamers = bootstrap.activeGameNightGamers
    .map((item) => bootstrap.gamers.find((gamer) => gamer.id === item.gamerId))
    .filter((gamer): gamer is Gamer => gamer !== undefined)
  const squadBrowser = useSquadBrowser(latestSquadVersion)
  // Settings is hidden from casual gamers — it exposes destructive controls
  // (squad reset, asset refresh) that aren't part of the normal flow. The
  // panel reveals itself once a user discovers the debug console via the
  // triple-tap on the bottom-nav logo (see `console-store.ts`). The unlock
  // is persisted in localStorage, so power-users keep their settings access
  // across reloads without having to re-trigger the gesture.
  const settingsUnlocked = useDebugConsole((s) => s.everOpened)

  // Admin-only reminder when a new squad version becomes available. We
  // localStorage-ack the latest version the admin has seen so the banner
  // only fires on genuine new arrivals (App.tsx polls /api/version while
  // Settings is unlocked, so a fresh ingest reaches us without a reload).
  const SQUAD_ACK_KEY = 'fc26:last-acked-squad-version'
  const [ackedSquadVersion, setAckedSquadVersion] = useState<string | null>(
    () => (typeof localStorage !== 'undefined' ? localStorage.getItem(SQUAD_ACK_KEY) : null),
  )
  useEffect(() => {
    if (!latestSquadVersion || ackedSquadVersion !== null) return
    // First time we've seen any squad version on this device — ack silently
    // so existing admins don't get a phantom reminder right after install.
    localStorage.setItem(SQUAD_ACK_KEY, latestSquadVersion)
    setAckedSquadVersion(latestSquadVersion)
  }, [latestSquadVersion, ackedSquadVersion])
  function dismissSquadReminder(): void {
    if (!latestSquadVersion) return
    localStorage.setItem(SQUAD_ACK_KEY, latestSquadVersion)
    setAckedSquadVersion(latestSquadVersion)
  }
  const showSquadReminder =
    settingsUnlocked &&
    latestSquadVersion !== null &&
    ackedSquadVersion !== null &&
    latestSquadVersion !== ackedSquadVersion

  function scrollToSection(sectionId: string): void {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // On room entry, jump straight to the live game/night section when there is
  // one, so the gamer doesn't have to scroll past the header/start panels to
  // reach the action. Mount-only — won't fight subsequent scroll positions.
  useEffect(() => {
    if (!bootstrap.activeGameNight) return
    requestAnimationFrame(() => {
      const el = document.getElementById('fc26-game-live-section')
      // `scrollIntoView` is missing in jsdom — guard the call so test renders
      // don't blow up when the active-night bootstrap path is exercised.
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'auto', block: 'start' })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // After a successful game-creation request the panel content swaps from the
  // creation form to `CurrentGameCard`. On phones that swap happens off-screen
  // because the form lives below the fold, so move the viewport to the live
  // section once bootstrap has the new `currentGame`.
  async function handleCreateGame(
    gameNightId: string,
    request: CreateCurrentGameRequest,
  ): Promise<void> {
    await onCreateGame(gameNightId, request)
    // Wait for the bootstrap state update + DOM commit before scrolling, so
    // the `CurrentGameCard` is what receives the focus.
    requestAnimationFrame(() => scrollToSection('fc26-game-live-section'))
  }

  return (
    <>
      <ActiveRoomHeader
        bootstrap={bootstrap}
        busy={busy}
        onLeaveRoom={onLeaveRoom}
        onOpenGamePanel={() =>
          scrollToSection(bootstrap.activeGameNight ? 'fc26-game-live-section' : 'fc26-game-section')
        }
        onOpenRoster={() => scrollToSection('fc26-roster-section')}
        onRefresh={onRefresh}
      />

      {showSquadReminder ? (
        <div
          style={{
            marginTop: 14,
            padding: '10px 12px',
            borderRadius: 14,
            background: '#fef3c7',
            border: '1px solid #f59e0b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13, color: '#78350f' }}>
            New squad version <strong>{latestSquadVersion}</strong> is available. Sync it
            from the Settings panel.
          </span>
          <button
            type="button"
            onClick={dismissSquadReminder}
            style={{
              border: '1px solid #b45309',
              background: '#fde68a',
              color: '#78350f',
              borderRadius: 999,
              padding: '4px 12px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Keeps the BottomNav "Game" anchor — falls through to the live
          section when there is one, otherwise lands on Start Game Night. */}
      <section
        id="fc26-game-section"
        style={{ marginTop: 18 }}
      >
        {bootstrap.activeGameNight ? null : (
          <StartGameNightPanel
            bootstrap={bootstrap}
            busy={busy}
            onStartGameNight={onStartGameNight}
          />
        )}
      </section>

      {bootstrap.activeGameNight ? (
        <section id="fc26-game-live-section" style={{ marginTop: 18 }}>
          <GameCreationPanel
            bootstrap={bootstrap}
            busy={busy}
            activeGameNightGamers={activeGameNightGamers}
            activeGameNightGamerIds={activeGameNightGamerIds}
            latestSquadVersion={latestSquadVersion}
            squadClubs={squadBrowser.teams.clubs}
            squadLoading={squadBrowser.teams.loading}
            squadBrowserTeams={squadBrowser.teams}
            onCreateGame={handleCreateGame}
            onInterruptGame={onInterruptGame}
            onRecordGameResult={onRecordGameResult}
            onAnalysePhoto={onAnalysePhoto}
          />
        </section>
      ) : null}

      <ScoreboardPanel
        scoreboard={scoreboard}
        onLoadMatchHistory={onLoadMatchHistory}
        onVoidGame={settingsUnlocked ? onVoidGame : undefined}
      />

      <TeamsPanel
        latestSquadVersion={latestSquadVersion}
        squadPanelError={squadBrowser.squadPanelError}
        squadVersions={squadBrowser.squadVersions}
        teams={squadBrowser.teams}
        changes={squadBrowser.changes}
        settingsUnlocked={settingsUnlocked}
        roomSquadPlatform={roomSquadPlatform}
      />

      {settingsUnlocked ? (
        <SettingsPanel
          bootstrap={bootstrap}
          busy={busy}
          latestSquadVersion={latestSquadVersion}
          roomSquadPlatform={roomSquadPlatform}
          onChangeRoomSquadPlatform={onChangeRoomSquadPlatform}
          onRefreshSquadAssets={onRefreshSquadAssets}
          onRepairSquads={onRepairSquads}
          onResetSquadData={onResetSquadData}
          onRetrieveSquadData={onRetrieveSquadData}
          onSaveRoomSettings={onSaveRoomSettings}
        />
      ) : null}

      <section id="fc26-roster-section">
        <RosterPanel
          bootstrap={bootstrap}
          busy={busy}
          activeGameNightGamerIds={activeGameNightGamerIds}
          currentGameGamerIds={currentGameGamerIds}
          onToggleGamer={onToggleGamer}
          onUpdateGamerDetails={onUpdateGamerDetails}
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
    </>
  )
}
