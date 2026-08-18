import { useEffect, useMemo, useState } from 'react'
import type {
  AnalysePhotoResponse,
  BetHistoryResponse,
  BetId,
  CreateCurrentGameRequest,
  Gamer,
  GamerId,
  ChipLedgerResponse,
  GameNightChipsResponse,
  GameResult,
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
import { RoomBar } from './RoomBar.jsx'
import { SettingsPanel } from './SettingsPanel.jsx'
import { ChipStandingsPanel } from '../gameNight/ChipStandingsPanel.jsx'
import { ChipLedgerPanel } from '../wager/ChipLedgerPanel.jsx'
import { WagerPage } from '../wager/WagerPage.jsx'
import type { Route } from '../../hooks/useHashRoute.js'
import type { BusyState } from '../../types/busyState.js'
import type { WorkerVersionInfo } from '../../lib/version.js'

export function RoomScreen({
  route,
  onNavigate,
  viewerId,
  onChangeViewer,
  onLoadBetHistory,
  bootstrap,
  busy,
  chips,
  ledger,
  onBuyChips,
  latestSquadVersion,
  roomSquadPlatform,
  scoreboard,
  onLoadMatchHistory,
  onVoidGame,
  onPlaceBet,
  onRemoveBet,
  onLockBets,
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
  worker,
  workerError,
  installStatus,
  onInstall,
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
  route: Route
  onNavigate: (route: Route) => void
  /** Whose wagers the Wager page shows; null means everyone. */
  viewerId: GamerId | null
  onChangeViewer: (next: GamerId | null) => void
  onLoadBetHistory: () => Promise<BetHistoryResponse>
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  chips: GameNightChipsResponse | null
  /** Room-wide chip ledger; null until it loads. */
  ledger: ChipLedgerResponse | null
  onBuyChips: (gamerId: GamerId, amount: number) => Promise<void>
  latestSquadVersion: string | null
  roomSquadPlatform: SquadPlatform
  scoreboard: RoomScoreboardResponse | null
  onLoadMatchHistory: (scope: MatchHistoryScope) => Promise<MatchHistoryResponse>
  onVoidGame: (gameNightId: string, gameId: string) => Promise<void>
  onPlaceBet: (request: { gamerId: GamerId; outcome: GameResult; stake: number }) => void
  onRemoveBet: (betId: BetId) => void
  onLockBets: () => void
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
  worker: WorkerVersionInfo | null
  workerError: string | null
  installStatus: string
  onInstall: () => void
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
  onStartGameNight: (buyIn: number) => Promise<void>
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

  async function handleCreateGame(
    gameNightId: string,
    request: CreateCurrentGameRequest,
  ): Promise<void> {
    await onCreateGame(gameNightId, request)
    // The Game page swaps the creation form for CurrentGameCard in place, so
    // there is nothing to scroll to any more — this used to chase the live
    // section down a long shared page.
  }

  return (
    <>
      <RoomBar
        bootstrap={bootstrap}
        busy={busy}
        worker={worker}
        workerError={workerError}
        installStatus={installStatus}
        onInstall={onInstall}
        onLeaveRoom={onLeaveRoom}
        onOpenSettings={settingsUnlocked ? () => onNavigate('settings') : undefined}
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

      {/* One page at a time. This used to be a single scrolling surface with
          every panel stacked, which made the bottom nav a set of scroll
          anchors rather than real navigation. */}
      {route === 'game' ? (
        <section id="fc26-game-section" style={{ marginTop: 18 }}>
          {bootstrap.activeGameNight ? (
            <div id="fc26-game-live-section">
              <GameCreationPanel
                bootstrap={bootstrap}
                busy={busy}
                ledger={ledger?.entries ?? []}
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
                onPlaceBet={onPlaceBet}
                onRemoveBet={onRemoveBet}
                onLockBets={onLockBets}
              />
            </div>
          ) : (
            <StartGameNightPanel busy={busy} onStartGameNight={onStartGameNight} />
          )}
        </section>
      ) : null}

      {route === 'scoreboard' ? (
        <ScoreboardPanel
          scoreboard={scoreboard}
          onLoadMatchHistory={onLoadMatchHistory}
          onVoidGame={settingsUnlocked ? onVoidGame : undefined}
        />
      ) : null}

      {route === 'wager' ? (
        <>
          <ChipLedgerPanel
            busy={busy}
            gamers={bootstrap.gamers}
            ledger={ledger}
            onBuyChips={onBuyChips}
          />
          {chips ? (
            <ChipStandingsPanel
              gamers={bootstrap.gamers}
              positions={chips.positions}
              lastGameDeltas={chips.lastGameDeltas}
            />
          ) : null}
          <WagerPage
            gamers={bootstrap.gamers}
            viewerId={viewerId}
            onChangeViewer={onChangeViewer}
            showAll={settingsUnlocked}
            onLoadHistory={onLoadBetHistory}
          />
        </>
      ) : null}

      {route === 'roster' ? (
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
      ) : null}

      {/* Teams lost its bottom-nav slot to Wager but keeps its route: the
          squad browser is still the only way to look up club ratings, and
          the Game page links here when picking FC teams. */}
      {route === 'teams' ? (
        <TeamsPanel
          latestSquadVersion={latestSquadVersion}
          squadPanelError={squadBrowser.squadPanelError}
          squadVersions={squadBrowser.squadVersions}
          teams={squadBrowser.teams}
          changes={squadBrowser.changes}
          settingsUnlocked={settingsUnlocked}
          roomSquadPlatform={roomSquadPlatform}
        />
      ) : null}

      {route === 'settings' ? (
        settingsUnlocked ? (
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
        ) : null
      ) : null}

    </>
  )
}
