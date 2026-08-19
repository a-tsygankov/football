import { startTransition, useCallback, useEffect, useState } from 'react'
import {
  type AnalysePhotoResponse,
  type Bet,
  type BetId,
  type BetsResponse,
  type CreateGamerRequest,
  type CreateCurrentGameRequest,
  type ChipLedgerResponse,
  type CurrentGame,
  DEFAULT_SQUAD_PLATFORM,
  type Gamer,
  type GamerId,
  type GamerResponse,
  type GameNightChipsResponse,
  type GameResult,
  type InterruptCurrentGameRequest,
  type MatchHistoryResponse,
  type MatchHistoryScope,
  type RecordCurrentGameResultRequest,
  type RefreshRoomSquadAssetsResponse,
  type RepairRoomSquadsResponse,
  type ResetRoomSquadsResponse,
  type ResolveCurrentGameResponse,
  type RetrieveRoomSquadsResponse,
  type RoomBootstrapResponse,
  type RoomScoreboardResponse,
  SQUAD_PLATFORMS,
  type SquadPlatform,
  type UpdateGamerRequest,
  type UpdateRoomSettingsRequest,
  type UpdateRoomSettingsResponse,
  type BetHistoryResponse,
  isClientOutdated,
} from '@fc26/shared'
import { BottomNav } from './components/BottomNav.jsx'
import { StatusCard } from './components/StatusCard.jsx'
import { UpdateBanner } from './components/UpdateBanner.jsx'
import { DebugConsole } from './debug/DebugConsole.jsx'
import {
  apiJson,
  clearPersistedRoomSession,
  persistLastBettor,
  persistRoomSession,
  readLastBettor,
} from './lib/api.js'
import { logger } from './lib/logger.js'
import { APP_VERSION, type WorkerVersionInfo } from './lib/version.js'
import { LandingScreen } from './features/landing/LandingScreen.jsx'
import { RoomScreen } from './features/room/RoomScreen.jsx'
import type { BusyState } from './types/busyState.js'
import { useInstallPrompt } from './hooks/useInstallPrompt.js'
import { useHashRoute } from './hooks/useHashRoute.js'

const LAST_ROOM_ID_KEY = 'fc26:last-room-id'

export function App() {
  const [worker, setWorker] = useState<WorkerVersionInfo | null>(null)
  const [workerError, setWorkerError] = useState<string | null>(null)
  const [bootstrap, setBootstrap] = useState<RoomBootstrapResponse | null>(null)
  const [scoreboard, setScoreboard] = useState<RoomScoreboardResponse | null>(null)
  const [chips, setChips] = useState<GameNightChipsResponse | null>(null)
  // Room-wide chip balances. Separate from `chips`, which is tonight's swing —
  // this one carries across nights and is what bets are checked against.
  const [ledger, setLedger] = useState<ChipLedgerResponse | null>(null)
  const [busy, setBusy] = useState<BusyState>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const install = useInstallPrompt()
  const [iosHint, setIosHint] = useState(false)

  const onPinClick = useCallback(() => {
    if (install.status === 'ready') install.prompt()
    else if (install.status === 'ios') setIosHint(h => !h)
  }, [install])

  const { route, navigate } = useHashRoute()

  // Which gamer the Wager page is scoped to. Reuses the bettor already
  // remembered for placing bets, so the ledger opens on the person using this
  // device rather than asking again. Purely local — the server has no idea who
  // is holding the phone, which is why this filter is a convenience and not a
  // permission.
  const [viewerId, setViewerId] = useState<GamerId | null>(null)

  const [createName, setCreateName] = useState('')
  const [createPin, setCreatePin] = useState('')
  const [joinRoomId, setJoinRoomId] = useState(() => {
    if (typeof localStorage === 'undefined') return ''
    return localStorage.getItem(LAST_ROOM_ID_KEY) ?? ''
  })
  const [joinPin, setJoinPin] = useState('')
  const [gamerName, setGamerName] = useState('')
  const [gamerRating, setGamerRating] = useState('3')
  const [gamerPin, setGamerPin] = useState('')
  const [gamerAvatarUrl, setGamerAvatarUrl] = useState<string | null>(null)
  const [roomSquadPlatform, setRoomSquadPlatform] = useState<SquadPlatform>(
    DEFAULT_SQUAD_PLATFORM,
  )

  useEffect(() => {
    logger.info('system', 'app booted', { appVersion: APP_VERSION })
    void apiJson<WorkerVersionInfo>('/api/version')
      .then((value) => {
        setWorker(value)
        logger.info('system', 'worker version loaded', value)
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        setWorkerError(message)
        logger.warn('system', 'worker version fetch failed', { error: message })
      })
  }, [])

  // Periodically re-fetch /api/version. This feeds two things: the admin-only
  // "new squads available" reminder in RoomScreen, and the update banner
  // below, which every user needs — a long-lived PWA tab is exactly how a
  // client drifts below `minClientVersion` without anyone noticing. So this
  // is gated on having a room open, not on Settings being unlocked; the
  // squad reminder does its own admin check.
  useEffect(() => {
    if (!bootstrap) return
    const intervalMs = 5 * 60 * 1000
    const tick = (): void => {
      void apiJson<WorkerVersionInfo>('/api/version')
        .then((value) => setWorker(value))
        .catch(() => {
          // Polling is best-effort — silent on failure.
        })
    }
    const handle = setInterval(tick, intervalMs)
    return () => clearInterval(handle)
  }, [bootstrap])

  useEffect(() => {
    if (!joinRoomId) return
    void refreshRoom(joinRoomId, { silentUnauthorized: true })
  }, [])

  // Seed the wager viewer from the remembered bettor, falling back to the
  // first gamer so the page is never empty on a fresh device.
  useEffect(() => {
    if (!bootstrap || viewerId !== null) return
    const remembered = readLastBettor(bootstrap.room.id)
    const known = bootstrap.gamers.find((g) => g.id === remembered)
    setViewerId((known?.id ?? bootstrap.gamers[0]?.id) ?? null)
  }, [bootstrap, viewerId])

  useEffect(() => {
    if (!bootstrap) {
      setScoreboard(null)
      return
    }
    setRoomSquadPlatform(bootstrap.room.squadPlatform ?? DEFAULT_SQUAD_PLATFORM)
    void refreshScoreboard(bootstrap.room.id)
  }, [bootstrap])

  // Chip standings follow the active night: load on entry, clear on exit.
  const activeGameNightId = bootstrap?.activeGameNight?.id ?? null
  useEffect(() => {
    if (!bootstrap || !activeGameNightId) {
      setChips(null)
      return
    }
    void loadChips(bootstrap.room.id, activeGameNightId)
    void loadLedger(bootstrap.room.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGameNightId])

  async function refreshRoom(
    roomId: string,
    options: { silentUnauthorized?: boolean } = {},
  ): Promise<void> {
    setBusy('refreshing-room')
    setError(null)
    try {
      const next = await apiJson<RoomBootstrapResponse>(`/api/rooms/${roomId}/bootstrap`)
      applyBootstrap(next)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!options.silentUnauthorized) {
        setError(message)
      }
      startTransition(() => setBootstrap(null))
      setScoreboard(null)
      logger.warn('system', 'room bootstrap failed', { roomId, error: message })
    } finally {
      setBusy(null)
    }
  }

  async function refreshScoreboard(roomId: string): Promise<void> {
    try {
      const next = await apiJson<RoomScoreboardResponse>(`/api/rooms/${roomId}/scoreboard`)
      startTransition(() => setScoreboard(next))
    } catch (err) {
      startTransition(() => setScoreboard(null))
      logger.warn('system', 'scoreboard fetch failed', {
        roomId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function loadChips(roomId: string, gameNightId: string): Promise<void> {
    try {
      const next = await apiJson<GameNightChipsResponse>(
        `/api/rooms/${roomId}/game-nights/${gameNightId}/chips`,
      )
      startTransition(() => setChips(next))
    } catch (err) {
      logger.warn('system', 'chips fetch failed', {
        roomId,
        gameNightId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function loadLedger(roomId: string): Promise<void> {
    try {
      const next = await apiJson<ChipLedgerResponse>(`/api/rooms/${roomId}/chips-ledger`)
      startTransition(() => setLedger(next))
    } catch (err) {
      logger.warn('system', 'chip ledger fetch failed', {
        roomId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function buyChips(gamerId: GamerId, amount: number): Promise<void> {
    if (!bootstrap) return
    setBusy('buying-chips')
    setError(null)
    try {
      const next = await apiJson<ChipLedgerResponse>(
        `/api/rooms/${bootstrap.room.id}/chips/purchases`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ gamerId, amount }),
        },
      )
      startTransition(() => setLedger(next))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  function applyBets(bets: ReadonlyArray<Bet>, betsLockedAt?: number | null): void {
    startTransition(() => {
      setBootstrap((current) =>
        current
          ? {
              ...current,
              bets,
              currentGame:
                betsLockedAt !== undefined && current.currentGame
                  ? { ...current.currentGame, betsLockedAt }
                  : current.currentGame,
            }
          : current,
      )
    })
  }

  async function placeBet(request: {
    gamerId: GamerId
    outcome: GameResult
    stake: number
  }): Promise<void> {
    if (!bootstrap?.activeGameNight || !bootstrap.currentGame) return
    setBusy('placing-bet')
    setError(null)
    try {
      const response = await apiJson<BetsResponse>(
        `/api/rooms/${bootstrap.room.id}/game-nights/${bootstrap.activeGameNight.id}/games/${bootstrap.currentGame.id}/bets`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        },
      )
      applyBets(response.bets)
      void loadLedger(bootstrap.room.id)
      persistLastBettor(bootstrap.room.id, request.gamerId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function removeBet(betId: BetId): Promise<void> {
    if (!bootstrap?.activeGameNight || !bootstrap.currentGame) return
    setBusy('removing-bet')
    setError(null)
    try {
      const response = await apiJson<BetsResponse>(
        `/api/rooms/${bootstrap.room.id}/game-nights/${bootstrap.activeGameNight.id}/games/${bootstrap.currentGame.id}/bets/${betId}`,
        { method: 'DELETE' },
      )
      applyBets(response.bets)
      void loadLedger(bootstrap.room.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function lockBets(): Promise<void> {
    if (!bootstrap?.activeGameNight || !bootstrap.currentGame) return
    setError(null)
    try {
      const response = await apiJson<BetsResponse>(
        `/api/rooms/${bootstrap.room.id}/game-nights/${bootstrap.activeGameNight.id}/games/${bootstrap.currentGame.id}/bets/lock`,
        { method: 'POST' },
      )
      applyBets(response.bets, response.betsLockedAt)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const loadMatchHistory = useCallback(
    async (scope: MatchHistoryScope): Promise<MatchHistoryResponse> => {
      if (!bootstrap) throw new Error('No active room')
      const query =
        scope.type === 'gamer'
          ? `gamerId=${encodeURIComponent(scope.gamerId)}`
          : scope.type === 'gamerTeam'
            ? `teamKey=${encodeURIComponent(scope.gamerTeamKey)}`
            : 'scope=all'
      return apiJson<MatchHistoryResponse>(
        `/api/rooms/${bootstrap.room.id}/match-history?${query}`,
      )
    },
    [bootstrap],
  )

  /**
   * Admin "delete game" — posts a void event for the recorded game and
   * refreshes the scoreboard so the row stops counting immediately. The
   * MatchHistoryList drops the entry locally; there's no need to refetch
   * the drill-down because the void event also removes it server-side.
   */
  const loadBetHistory = useCallback(async (): Promise<BetHistoryResponse> => {
    if (!bootstrap) throw new Error('No active room')
    return apiJson<BetHistoryResponse>(`/api/rooms/${bootstrap.room.id}/bet-history`)
  }, [bootstrap])

  const voidGame = useCallback(
    async (gameNightId: string, gameId: string): Promise<void> => {
      if (!bootstrap) throw new Error('No active room')
      await apiJson<{ eventId: string; eventType: string }>(
        `/api/rooms/${bootstrap.room.id}/game-nights/${gameNightId}/games/${gameId}/void`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'admin_delete' }),
        },
      )
      await refreshScoreboard(bootstrap.room.id)
      if (bootstrap.activeGameNight) {
        await loadChips(bootstrap.room.id, bootstrap.activeGameNight.id)
        await loadLedger(bootstrap.room.id)
      }
    },
    [bootstrap],
  )

  async function refreshSquadAssets(
    roomId: string,
    mode: 'soft' | 'hard' = 'soft',
  ): Promise<void> {
    // Two busy states so the "Refresh missing logos" button can stay lit on a
    // soft run while the "Re-fetch all logos" button stays lit on a hard run.
    // They share the same notice/error lanes though — only one is ever in
    // flight at a time because both set `busy`.
    setBusy(mode === 'hard' ? 'hard-refreshing-squad-assets' : 'refreshing-squad-assets')
    setError(null)
    setNotice(null)
    try {
      const query = mode === 'hard' ? '?mode=hard' : ''
      const response = await apiJson<RefreshRoomSquadAssetsResponse>(
        `/api/rooms/${roomId}/settings/squad-assets/refresh${query}`,
        { method: 'POST' },
      )
      const { result } = response
      setNotice(
        result.status === 'refreshed'
          ? `Logos ${mode === 'hard' ? 're-fetched' : 'refreshed'} across ${result.versionCount} stored squad versions. Matched ${result.matchedClubCount} clubs and ${result.matchedLeagueCount} leagues.`
          : 'No stored squad logos needed updating.',
      )
      void apiJson<WorkerVersionInfo>('/api/version')
        .then((value) => setWorker(value))
        .catch(() => undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function retrieveSquadData(roomId: string): Promise<void> {
    setBusy('retrieving-squad-data')
    setError(null)
    setNotice(null)
    try {
      const response = await apiJson<RetrieveRoomSquadsResponse>(
        `/api/rooms/${roomId}/settings/squads/retrieve`,
        { method: 'POST' },
      )
      const { result, assetsResult } = response
      const ingestNotice =
        result.status === 'ingested'
          ? `Fetched squad clubs and players for ${result.version}${result.platform ? ` on ${SQUAD_PLATFORMS[result.platform as SquadPlatform]?.label ?? result.platform}` : ''}. Stored ${result.clubCount} clubs and ${result.playerCount} players.`
          : result.status === 'noop'
            ? `Squad version ${result.version ?? 'unknown'} is already stored.`
            : 'Squad retrieval is disabled because no upstream source is configured.'
      // Append the chained asset-refresh outcome so the user understands why
      // some logos may still be missing (typically national/international
      // sides SportsDB can't match).
      const assetsNotice =
        assetsResult === null
          ? ' Logo refresh failed — retry from Settings.'
          : assetsResult.status === 'refreshed'
            ? ` Logos: matched ${assetsResult.matchedClubCount} clubs, ${assetsResult.matchedLeagueCount} leagues; ${assetsResult.unmatchedClubs.length} unmatched.`
            : assetsResult.status === 'noop'
              ? ' Logos already up to date.'
              : ''
      setNotice(`${ingestNotice}${assetsNotice}`)
      void apiJson<WorkerVersionInfo>('/api/version')
        .then((value) => setWorker(value))
        .catch(() => undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function saveRoomSettings(roomId: string): Promise<void> {
    setBusy('saving-room-settings')
    setError(null)
    setNotice(null)
    try {
      const response = await apiJson<UpdateRoomSettingsResponse>(
        `/api/rooms/${roomId}/settings`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            squadPlatform: roomSquadPlatform,
          } satisfies UpdateRoomSettingsRequest),
        },
      )
      startTransition(() => {
        setBootstrap((current) =>
          current
            ? {
                ...current,
                room: response.room,
              }
            : current,
        )
      })
      setNotice(`Room squad platform saved as ${SQUAD_PLATFORMS[response.room.squadPlatform].label}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function repairSquadData(roomId: string): Promise<void> {
    // One-shot migration for stored squad versions that were ingested before
    // the league-canonicalisation fix landed. Safe to run repeatedly —
    // after the first successful pass it becomes a no-op.
    setBusy('repairing-squad-data')
    setError(null)
    setNotice(null)
    try {
      const response = await apiJson<RepairRoomSquadsResponse>(
        `/api/rooms/${roomId}/settings/squads/repair`,
        { method: 'POST' },
      )
      const { result } = response
      if (result.status === 'repaired') {
        // Build one sentence that surfaces every moving part of the
        // migration. Users rarely run this twice in a row, so the extra
        // detail is worth the longer notice — especially the history
        // counts, because those are the bit that's invisible otherwise.
        const parts: string[] = []
        if (result.collapsedLeagueCount > 0) {
          parts.push(
            `collapsed ${result.collapsedLeagueCount} duplicate league id${result.collapsedLeagueCount === 1 ? '' : 's'}`,
          )
        }
        if (result.collapsedClubCount > 0) {
          parts.push(
            `removed ${result.collapsedClubCount} duplicate club${result.collapsedClubCount === 1 ? '' : 's'}`,
          )
        }
        if (result.rewrittenClubCount > 0) {
          parts.push(
            `rewrote ${result.rewrittenClubCount} club row${result.rewrittenClubCount === 1 ? '' : 's'}`,
          )
        }
        if (result.rewrittenGameRowCount > 0) {
          parts.push(
            `updated ${result.rewrittenGameRowCount} game record${result.rewrittenGameRowCount === 1 ? '' : 's'}`,
          )
        }
        if (result.rewrittenEventPayloadCount > 0) {
          parts.push(
            `updated ${result.rewrittenEventPayloadCount} historical event${result.rewrittenEventPayloadCount === 1 ? '' : 's'}`,
          )
        }
        const headline =
          parts.length > 0 ? parts.join(', ') : 'rewrote stored squad data'
        setNotice(
          `Repair done across ${result.rewrittenVersionCount} stored squad version${result.rewrittenVersionCount === 1 ? '' : 's'}: ${headline}.`,
        )
      } else {
        setNotice('Stored squads were already canonical — nothing to repair.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function resetSquadData(roomId: string): Promise<void> {
    setBusy('resetting-squad-data')
    setError(null)
    setNotice(null)
    try {
      const response = await apiJson<ResetRoomSquadsResponse>(
        `/api/rooms/${roomId}/settings/squads/reset`,
        { method: 'POST' },
      )
      const { result } = response
      setNotice(
        result.status === 'reset'
          ? `Deleted ${result.deletedVersionCount} stored squad version${result.deletedVersionCount === 1 ? '' : 's'}.`
          : 'No stored squad data was present to reset.',
      )
      setWorker((current) => (current ? { ...current, latestSquadVersion: null } : current))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function createRoom(): Promise<void> {
    if (!createName.trim()) return
    setBusy('creating-room')
    setError(null)
    try {
      const next = await apiJson<RoomBootstrapResponse>('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          pin: createPin.trim() || null,
        }),
      })
      applyBootstrap(next)
      setCreateName('')
      setCreatePin('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function joinRoom(): Promise<void> {
    if (!joinRoomId.trim()) return
    setBusy('joining-room')
    setError(null)
    try {
      const next = await apiJson<RoomBootstrapResponse>(
        `/api/rooms/${joinRoomId.trim()}/sessions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            identifier: joinRoomId.trim(),
            pin: joinPin.trim() || null,
          }),
        },
      )
      applyBootstrap(next)
      setJoinPin('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function createGamer(): Promise<void> {
    if (!bootstrap || !gamerName.trim()) return
    setBusy('creating-gamer')
    setError(null)
    try {
      const response = await apiJson<GamerResponse>(`/api/rooms/${bootstrap.room.id}/gamers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: gamerName.trim(),
          rating: Number.parseInt(gamerRating, 10),
          pin: gamerPin.trim() || null,
          avatarUrl: gamerAvatarUrl,
        } satisfies CreateGamerRequest),
      })
      startTransition(() => {
        setBootstrap((current) =>
          current
            ? {
                ...current,
                gamers: [...current.gamers, response.gamer],
                activeGameNightGamers:
                  response.activeGameNightGamers ?? current.activeGameNightGamers,
              }
            : current,
        )
      })
      setGamerName('')
      setGamerRating('3')
      setGamerPin('')
      setGamerAvatarUrl(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function toggleGamer(gamer: Gamer): Promise<void> {
    if (!bootstrap) return
    setBusy('updating-gamer')
    setError(null)
    try {
      const response = await apiJson<GamerResponse>(
        `/api/rooms/${bootstrap.room.id}/gamers/${gamer.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ active: !gamer.active }),
        },
      )
      startTransition(() => {
        setBootstrap((current) =>
          current
            ? {
                ...current,
                gamers: current.gamers.map((item) =>
                  item.id === response.gamer.id ? response.gamer : item,
                ),
                activeGameNightGamers:
                  response.activeGameNightGamers ?? current.activeGameNightGamers,
              }
            : current,
        )
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function updateGamerDetails(
    gamerId: string,
    request: UpdateGamerRequest,
  ): Promise<void> {
    if (!bootstrap) return
    setBusy('updating-gamer')
    setError(null)
    try {
      const response = await apiJson<GamerResponse>(
        `/api/rooms/${bootstrap.room.id}/gamers/${gamerId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        },
      )
      startTransition(() => {
        setBootstrap((current) =>
          current
            ? {
                ...current,
                gamers: current.gamers.map((item) =>
                  item.id === response.gamer.id ? response.gamer : item,
                ),
                activeGameNightGamers:
                  response.activeGameNightGamers ?? current.activeGameNightGamers,
              }
            : current,
        )
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function startGameNight(buyIn: number): Promise<void> {
    if (!bootstrap) return
    setBusy('starting-game-night')
    setError(null)
    try {
      await apiJson(`/api/rooms/${bootstrap.room.id}/game-nights`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ buyIn }),
      })
      await refreshRoom(bootstrap.room.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  async function createGame(
    gameNightId: string,
    request: CreateCurrentGameRequest,
  ): Promise<void> {
    if (!bootstrap) return
    setBusy('creating-game')
    setError(null)
    try {
      const response = await apiJson<{ currentGame: CurrentGame; bets: ReadonlyArray<Bet> }>(
        `/api/rooms/${bootstrap.room.id}/game-nights/${gameNightId}/games`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        },
      )
      startTransition(() => {
        setBootstrap((current) =>
          current
            ? {
                ...current,
                currentGame: response.currentGame,
                bets: response.bets,
                activeGameNight: current.activeGameNight
                  ? {
                      ...current.activeGameNight,
                      lastGameAt: response.currentGame.createdAt,
                      updatedAt: response.currentGame.createdAt,
                    }
                  : current.activeGameNight,
              }
            : current,
        )
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function recordGameResult(
    gameNightId: string,
    gameId: string,
    request: RecordCurrentGameResultRequest,
  ): Promise<void> {
    if (!bootstrap) return
    setBusy('recording-game')
    setError(null)
    try {
      const response = await apiJson<ResolveCurrentGameResponse>(
        `/api/rooms/${bootstrap.room.id}/game-nights/${gameNightId}/games/${gameId}/result`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        },
      )
      startTransition(() => {
        setBootstrap((current) =>
          current
            ? {
                ...current,
                currentGame: response.currentGame,
                // Recording settles the book server-side; the live rows are gone.
                bets: [],
                activeGameNight: response.activeGameNight,
              }
            : current,
        )
      })
      await refreshScoreboard(bootstrap.room.id)
      await loadChips(bootstrap.room.id, gameNightId)
      await loadLedger(bootstrap.room.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function analysePhoto(
    gameNightId: string,
    gameId: string,
    image: string,
    homeTeam?: { name: string; aliases: string[] } | null,
    awayTeam?: { name: string; aliases: string[] } | null,
  ): Promise<AnalysePhotoResponse> {
    if (!bootstrap) throw new Error('No active room')
    setBusy('analysing-photo')
    setError(null)
    try {
      return await apiJson<AnalysePhotoResponse>(
        `/api/rooms/${bootstrap.room.id}/game-nights/${gameNightId}/games/${gameId}/analyse-photo`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ image, homeTeam, awayTeam }),
        },
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setBusy(null)
    }
  }

  async function interruptGame(
    gameNightId: string,
    gameId: string,
    request: InterruptCurrentGameRequest,
  ): Promise<void> {
    if (!bootstrap) return
    setBusy('interrupting-game')
    setError(null)
    try {
      const response = await apiJson<ResolveCurrentGameResponse>(
        `/api/rooms/${bootstrap.room.id}/game-nights/${gameNightId}/games/${gameId}/interrupt`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        },
      )
      startTransition(() => {
        setBootstrap((current) =>
          current
            ? {
                ...current,
                currentGame: response.currentGame,
                // An interrupt discards the book server-side.
                bets: [],
                activeGameNight: response.activeGameNight,
              }
            : current,
        )
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  function applyBootstrap(next: RoomBootstrapResponse): void {
    persistRoomSession(next.session)
    // `apiJson` casts the response to its type without validating it, so the
    // declared shape is a promise the server may not keep. A worker older
    // than the wagering feature answers /bootstrap without `bets`, and an
    // undefined list used to crash the whole room screen on first render
    // (BetsPanel reduces over it). Normalise here — the single entry point
    // for server bootstraps — so every consumer sees a real array. The other
    // setBootstrap callers spread from already-normalised state.
    const normalised: RoomBootstrapResponse = { ...next, bets: next.bets ?? [] }
    startTransition(() => {
      setBootstrap(normalised)
      setJoinRoomId(next.room.id)
    })
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LAST_ROOM_ID_KEY, next.room.id)
    }
  }

  function leaveRoom(): void {
    clearPersistedRoomSession()
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LAST_ROOM_ID_KEY)
    }
    startTransition(() => {
      setBootstrap(null)
      setScoreboard(null)
      setJoinRoomId('')
    })
    setJoinPin('')
    setError(null)
    setNotice('Left the room. Create a new one or join a different room.')
    logger.info('system', 'left room')
  }

  // The worker publishes a floor for client builds; warn when this bundle has
  // dropped below it. Rendered outside <main> so it pins to the top of the
  // viewport on both the landing and room screens — a stale client is worth
  // flagging whether or not you have joined a room yet.
  const clientOutdated =
    worker !== null && isClientOutdated(APP_VERSION, worker.minClientVersion)

  return (
    <div
      style={{
        minHeight: '100dvh',
        paddingBottom: 'calc(64px + env(safe-area-inset-bottom))',
        fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
        background:
          'radial-gradient(circle at top, rgba(16,185,129,0.18), transparent 40%), linear-gradient(180deg, #f8fafc 0%, #ecfdf5 52%, #d1fae5 100%)',
        color: '#052e16',
      }}
    >
      {clientOutdated && worker ? (
        <UpdateBanner
          clientVersion={APP_VERSION}
          minClientVersion={worker.minClientVersion}
          onReload={() => window.location.reload()}
        />
      ) : null}
      <main style={{ padding: 20, maxWidth: 560, margin: '0 auto' }}>
        {bootstrap ? null : (
          <>
        <section
          style={{
            borderRadius: 28,
            padding: 24,
            background: 'rgba(255,255,255,0.78)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(5,46,22,0.08)',
            boxShadow: '0 18px 48px rgba(5,46,22,0.12)',
          }}
        >
          <p style={{ margin: 0, letterSpacing: '0.18em', textTransform: 'uppercase', fontSize: 11 }}>
            FC26 Team Picker
          </p>
          <h1 style={{ fontSize: 34, lineHeight: 1.05, margin: '12px 0 10px' }}>
            Room control for tonight&apos;s football session
          </h1>
          <p style={{ margin: 0, fontSize: 15, opacity: 0.8 }}>
            Create a room, rejoin an existing one, manage the roster, and start the active game
            night without leaving the phone.
          </p>
        </section>

        <section
          style={{
            marginTop: 18,
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          }}
        >
          <StatusCard label="Client" value={APP_VERSION} tone="light" />
          <StatusCard
            label="Worker"
            value={
              worker
                ? `v${worker.workerVersion} • schema ${worker.schemaVersion}`
                : workerError
                  ? `unreachable: ${workerError}`
                  : 'loading...'
            }
            tone={workerError ? 'warn' : 'light'}
          />
          <StatusCard
            label="Squads"
            value={
              worker
                ? worker.latestSquadVersion
                  ? worker.latestSquadVersion
                  : 'unseeded'
                : 'loading...'
            }
            tone={worker?.latestSquadVersion ? 'light' : 'warn'}
          />
          {(install.status === 'ready' || install.status === 'ios') && (
            <button
              onClick={onPinClick}
              style={{
                padding: '14px 16px',
                borderRadius: 20,
                background: 'rgba(255,255,255,0.78)',
                border: '1px solid rgba(5,46,22,0.08)',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v10M8 11l4 4 4-4"/>
                <rect x="3" y="17" width="18" height="3" rx="1.5"/>
              </svg>
              <div>
                <p style={{ margin: 0, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', opacity: 0.6 }}>
                  Pin to Desktop
                </p>
                <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.7 }}>
                  {install.status === 'ios' ? 'Tap for steps' : 'Install app'}
                </p>
              </div>
            </button>
          )}
        </section>
        {iosHint && (
          <div
            style={{
              marginTop: 12,
              padding: '14px 16px',
              borderRadius: 18,
              background: '#ecfdf5',
              border: '1px solid #86efac',
              color: '#166534',
              fontSize: 14,
            }}
          >
            Tap the <strong>Share</strong> button in your browser, then choose{' '}
            <strong>Add to Home Screen</strong>.
          </div>
        )}

          </>
        )}

        {error ? (
          <div
            role="alert"
            style={{
              marginTop: 16,
              padding: '14px 16px',
              borderRadius: 18,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
            }}
          >
            {error}
          </div>
        ) : null}
        {notice ? (
          <div
            style={{
              marginTop: 16,
              padding: '14px 16px',
              borderRadius: 18,
              background: '#ecfdf5',
              border: '1px solid #86efac',
              color: '#166534',
            }}
          >
            {notice}
          </div>
        ) : null}

        {bootstrap ? (
          <RoomScreen
            route={route}
            onNavigate={navigate}
            viewerId={viewerId}
            onChangeViewer={setViewerId}
            onLoadBetHistory={loadBetHistory}
            bootstrap={bootstrap}
            busy={busy}
            worker={worker}
            workerError={workerError}
            installStatus={install.status}
            onInstall={onPinClick}
            chips={chips}
            ledger={ledger}
            onBuyChips={buyChips}
            latestSquadVersion={worker?.latestSquadVersion ?? null}
            roomSquadPlatform={roomSquadPlatform}
            scoreboard={scoreboard}
            onLoadMatchHistory={loadMatchHistory}
            onVoidGame={voidGame}
            onPlaceBet={(request) => void placeBet(request)}
            onRemoveBet={(betId) => void removeBet(betId)}
            onLockBets={() => void lockBets()}
            gamerName={gamerName}
            gamerRating={gamerRating}
            gamerPin={gamerPin}
            gamerAvatarUrl={gamerAvatarUrl}
            onChangeGamerName={setGamerName}
            onChangeGamerPin={setGamerPin}
            onChangeGamerRating={setGamerRating}
            onChangeGamerAvatar={setGamerAvatarUrl}
            onCreateGamer={createGamer}
            onCreateGame={createGame}
            onInterruptGame={interruptGame}
            onLeaveRoom={leaveRoom}
            onRecordGameResult={recordGameResult}
            onAnalysePhoto={analysePhoto}
            onRefresh={() => refreshRoom(bootstrap.room.id)}
            onRepairSquads={() => repairSquadData(bootstrap.room.id)}
            onResetSquadData={() => resetSquadData(bootstrap.room.id)}
            onRetrieveSquadData={() => retrieveSquadData(bootstrap.room.id)}
            onRefreshSquadAssets={(mode) => refreshSquadAssets(bootstrap.room.id, mode)}
            onSaveRoomSettings={() => saveRoomSettings(bootstrap.room.id)}
            onChangeRoomSquadPlatform={setRoomSquadPlatform}
            onStartGameNight={startGameNight}
            onToggleGamer={toggleGamer}
            onUpdateGamerDetails={updateGamerDetails}
          />
        ) : (
          <LandingScreen
            busy={busy}
            createName={createName}
            createPin={createPin}
            joinRoomId={joinRoomId}
            joinPin={joinPin}
            onCreateName={setCreateName}
            onCreatePin={setCreatePin}
            onJoinRoomId={setJoinRoomId}
            onJoinPin={setJoinPin}
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
          />
        )}

        <p style={{ marginTop: 26, fontSize: 13, opacity: 0.65 }}>
          Triple-tap the FC26 logo in the bottom nav to open the debug console.
        </p>
      </main>

      <BottomNav route={route} onNavigate={navigate} />
      <DebugConsole />
    </div>
  )
}
