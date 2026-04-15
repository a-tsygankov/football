import { startTransition, useEffect, useState } from 'react'
import {
  type CreateGamerRequest,
  type CreateCurrentGameRequest,
  type CurrentGame,
  DEFAULT_SQUAD_PLATFORM,
  type Gamer,
  type InterruptCurrentGameRequest,
  type RecordCurrentGameResultRequest,
  type RefreshRoomSquadAssetsResponse,
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
} from '@fc26/shared'
import { BottomNav } from './components/BottomNav.jsx'
import { StatusCard } from './components/StatusCard.jsx'
import { DebugConsole } from './debug/DebugConsole.jsx'
import { apiJson, clearPersistedRoomSession, persistRoomSession } from './lib/api.js'
import { logger } from './lib/logger.js'
import { APP_VERSION, type WorkerVersionInfo } from './lib/version.js'
import { LandingScreen } from './features/landing/LandingScreen.jsx'
import { RoomScreen } from './features/room/RoomScreen.jsx'
import type { BusyState } from './types/busyState.js'

const LAST_ROOM_ID_KEY = 'fc26:last-room-id'

export function App() {
  const [worker, setWorker] = useState<WorkerVersionInfo | null>(null)
  const [workerError, setWorkerError] = useState<string | null>(null)
  const [bootstrap, setBootstrap] = useState<RoomBootstrapResponse | null>(null)
  const [scoreboard, setScoreboard] = useState<RoomScoreboardResponse | null>(null)
  const [busy, setBusy] = useState<BusyState>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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

  useEffect(() => {
    if (!joinRoomId) return
    void refreshRoom(joinRoomId, { silentUnauthorized: true })
  }, [])

  useEffect(() => {
    if (!bootstrap) {
      setScoreboard(null)
      return
    }
    setRoomSquadPlatform(bootstrap.room.squadPlatform ?? DEFAULT_SQUAD_PLATFORM)
    void refreshScoreboard(bootstrap.room.id)
  }, [bootstrap])

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

  async function refreshSquadAssets(roomId: string): Promise<void> {
    setBusy('refreshing-squad-assets')
    setError(null)
    setNotice(null)
    try {
      const response = await apiJson<RefreshRoomSquadAssetsResponse>(
        `/api/rooms/${roomId}/settings/squad-assets/refresh`,
        { method: 'POST' },
      )
      const { result } = response
      setNotice(
        result.status === 'refreshed'
          ? `Logos refreshed across ${result.versionCount} stored squad versions. Matched ${result.matchedClubCount} clubs and ${result.matchedLeagueCount} leagues.`
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
      const response = await apiJson<{ gamer: Gamer }>(`/api/rooms/${bootstrap.room.id}/gamers`, {
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
            ? { ...current, gamers: [...current.gamers, response.gamer] }
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
      const response = await apiJson<{ gamer: Gamer }>(
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
      const response = await apiJson<{ gamer: Gamer }>(
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

  async function startGameNight(): Promise<void> {
    if (!bootstrap) return
    setBusy('starting-game-night')
    setError(null)
    try {
      await apiJson(`/api/rooms/${bootstrap.room.id}/game-nights`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
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
      const response = await apiJson<{ currentGame: CurrentGame }>(
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
                activeGameNight: response.activeGameNight,
              }
            : current,
        )
      })
      await refreshScoreboard(bootstrap.room.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
    startTransition(() => {
      setBootstrap(next)
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
      <main style={{ padding: 20, maxWidth: 560, margin: '0 auto' }}>
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
        </section>

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
            bootstrap={bootstrap}
            busy={busy}
            latestSquadVersion={worker?.latestSquadVersion ?? null}
            roomSquadPlatform={roomSquadPlatform}
            scoreboard={scoreboard}
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
            onRefresh={() => refreshRoom(bootstrap.room.id)}
            onResetSquadData={() => resetSquadData(bootstrap.room.id)}
            onRetrieveSquadData={() => retrieveSquadData(bootstrap.room.id)}
            onRefreshSquadAssets={() => refreshSquadAssets(bootstrap.room.id)}
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

      <BottomNav />
      <DebugConsole />
    </div>
  )
}
