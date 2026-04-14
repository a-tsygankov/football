import { startTransition, useEffect, useMemo, useState } from 'react'
import {
  type CreateGamerRequest,
  type CreateCurrentGameRequest,
  type CurrentGame,
  formatLocal,
  formatRelative,
  GAME_FORMATS,
  type InterruptCurrentGameRequest,
  isValidNameStem,
  type Gamer,
  inferGameFormat,
  listStrategies,
  normalizeNameStem,
  type RecordCurrentGameResultRequest,
  type ResolveCurrentGameResponse,
  type RoomBootstrapResponse,
  type UpdateGamerRequest,
} from '@fc26/shared'
import { apiJson, persistRoomSession } from './lib/api.js'
import { logger } from './lib/logger.js'
import { APP_VERSION, type WorkerVersionInfo } from './lib/version.js'
import { BottomNav } from './components/BottomNav.jsx'
import { DebugConsole } from './debug/DebugConsole.jsx'
import { defaultAvatar, imageFileToAvatarDataUrl } from './lib/avatars.js'

const LAST_ROOM_ID_KEY = 'fc26:last-room-id'

type BusyState =
  | 'creating-room'
  | 'joining-room'
  | 'refreshing-room'
  | 'creating-gamer'
  | 'updating-gamer'
  | 'saving-active-gamers'
  | 'starting-game-night'
  | 'creating-game'
  | 'recording-game'
  | 'interrupting-game'
  | null

export function App() {
  const [worker, setWorker] = useState<WorkerVersionInfo | null>(null)
  const [workerError, setWorkerError] = useState<string | null>(null)
  const [bootstrap, setBootstrap] = useState<RoomBootstrapResponse | null>(null)
  const [busy, setBusy] = useState<BusyState>(null)
  const [error, setError] = useState<string | null>(null)

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
      logger.warn('system', 'room bootstrap failed', { roomId, error: message })
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
      const response = await apiJson<{ gamer: Gamer }>(
        `/api/rooms/${bootstrap.room.id}/gamers`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: gamerName.trim(),
            rating: Number.parseInt(gamerRating, 10),
            pin: gamerPin.trim() || null,
            avatarUrl: gamerAvatarUrl,
          } satisfies CreateGamerRequest),
        },
      )
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

  async function saveActiveGameNightGamers(
    gameNightId: string,
    activeGamerIds: string[],
  ): Promise<void> {
    if (!bootstrap) return
    setBusy('saving-active-gamers')
    setError(null)
    try {
      const response = await apiJson<{
        activeGamers: RoomBootstrapResponse['activeGameNightGamers']
      }>(`/api/rooms/${bootstrap.room.id}/game-nights/${gameNightId}/active-gamers`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ activeGamerIds }),
      })
      startTransition(() => {
        setBootstrap((current) =>
          current
            ? {
                ...current,
                activeGameNightGamers: response.activeGamers,
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
    localStorage.setItem(LAST_ROOM_ID_KEY, next.room.id)
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
            Create a room, rejoin an existing one, manage the roster, and start the active
            game night without leaving the phone.
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

        {bootstrap ? (
          <RoomScreen
            bootstrap={bootstrap}
            busy={busy}
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
            onRecordGameResult={recordGameResult}
            onRefresh={() => refreshRoom(bootstrap.room.id)}
            onSaveActiveGameNightGamers={saveActiveGameNightGamers}
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

function LandingScreen({
  busy,
  createName,
  createPin,
  joinRoomId,
  joinPin,
  onCreateName,
  onCreatePin,
  onJoinRoomId,
  onJoinPin,
  onCreateRoom,
  onJoinRoom,
}: {
  busy: BusyState
  createName: string
  createPin: string
  joinRoomId: string
  joinPin: string
  onCreateName: (value: string) => void
  onCreatePin: (value: string) => void
  onJoinRoomId: (value: string) => void
  onJoinPin: (value: string) => void
  onCreateRoom: () => Promise<void>
  onJoinRoom: () => Promise<void>
}) {
  const createRoomNameValid = isValidNameStem(createName)
  const createRoomPinValid = createPin.trim().length === 0 || /^\d{4}$/.test(createPin.trim())
  return (
    <section
      style={{
        marginTop: 20,
        display: 'grid',
        gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      }}
    >
      <Panel title="Create room" subtitle="Spin up a fresh room and land inside it immediately.">
        <Field label="Room name">
          <input
            value={createName}
            onChange={(event) => onCreateName(event.target.value)}
            placeholder="Friday FC"
            style={inputStyle}
          />
        </Field>
        <Field label="Optional PIN">
          <input
            value={createPin}
            onChange={(event) => onCreatePin(event.target.value)}
            placeholder="4 digits"
            inputMode="numeric"
            maxLength={4}
            style={inputStyle}
          />
        </Field>
        <p style={{ margin: '0 0 12px', fontSize: 13, opacity: 0.7 }}>
          Room names compare by stem: case, spaces, and punctuation are ignored.
        </p>
        {!createRoomNameValid && createName.trim().length > 0 ? (
          <InlineNotice tone="warn" message="Enter at least one letter or digit in the room name." />
        ) : null}
        {!createRoomPinValid ? (
          <InlineNotice tone="warn" message="Room PIN must be exactly 4 digits." />
        ) : null}
        <button
          type="button"
          disabled={busy !== null || !createRoomNameValid || !createRoomPinValid || !createName.trim()}
          onClick={() => void onCreateRoom()}
          style={primaryButtonStyle}
        >
          {busy === 'creating-room' ? 'Creating room...' : 'Create room'}
        </button>
      </Panel>

      <Panel title="Join room" subtitle="Re-enter by room id, room name, and optional PIN.">
        <Field label="Room id or room name">
          <input
            value={joinRoomId}
            onChange={(event) => onJoinRoomId(event.target.value)}
            placeholder="Paste room id or type room name"
            style={inputStyle}
          />
        </Field>
        <Field label="PIN">
          <input
            value={joinPin}
            onChange={(event) => onJoinPin(event.target.value)}
            placeholder="4 digits if needed"
            inputMode="numeric"
            maxLength={4}
            style={inputStyle}
          />
        </Field>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void onJoinRoom()}
          style={secondaryButtonStyle}
        >
          {busy === 'joining-room' ? 'Joining...' : 'Join room'}
        </button>
      </Panel>
    </section>
  )
}

function RoomScreen({
  bootstrap,
  busy,
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
  onRecordGameResult,
  onRefresh,
  onSaveActiveGameNightGamers,
  onStartGameNight,
  onToggleGamer,
  onUpdateGamerDetails,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
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
  onRecordGameResult: (
    gameNightId: string,
    gameId: string,
    request: RecordCurrentGameResultRequest,
  ) => Promise<void>
  onRefresh: () => Promise<void>
  onSaveActiveGameNightGamers: (
    gameNightId: string,
    activeGamerIds: string[],
  ) => Promise<void>
  onStartGameNight: () => Promise<void>
  onToggleGamer: (gamer: Gamer) => Promise<void>
  onUpdateGamerDetails: (gamerId: string, request: UpdateGamerRequest) => Promise<void>
}) {
  const strategyOptions = useMemo(() => listStrategies(), [])
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
  const [allocationMode, setAllocationMode] = useState<'manual' | 'random'>('manual')
  const [randomFormat, setRandomFormat] = useState<keyof typeof GAME_FORMATS>('2v2')
  const [randomStrategyId, setRandomStrategyId] = useState(bootstrap.room.defaultSelectionStrategy)
  const [manualAssignments, setManualAssignments] = useState<
    Record<string, 'home' | 'away' | 'bench'>
  >({})
  const [editingGamerId, setEditingGamerId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingRating, setEditingRating] = useState('3')
  const [editingCurrentPin, setEditingCurrentPin] = useState('')
  const [editingNextPin, setEditingNextPin] = useState('')
  const activeRoomGamers = bootstrap.gamers.filter((gamer) => gamer.active)
  const activeGameNightGamers = bootstrap.activeGameNightGamers
    .map((item) => bootstrap.gamers.find((gamer) => gamer.id === item.gamerId))
    .filter((gamer): gamer is Gamer => gamer !== undefined)
  const availableRandomFormats = Object.values(GAME_FORMATS).filter(
    (format) => format.size <= activeGameNightGamers.length,
  )

  useEffect(() => {
    setDraftActiveGamerIds(bootstrap.activeGameNightGamers.map((item) => item.gamerId))
  }, [bootstrap.activeGameNightGamers])

  useEffect(() => {
    setRandomStrategyId(bootstrap.room.defaultSelectionStrategy)
  }, [bootstrap.room.defaultSelectionStrategy])

  useEffect(() => {
    setManualAssignments(buildManualAssignments(bootstrap.currentGame))
  }, [bootstrap.activeGameNight?.id, bootstrap.currentGame])

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
  const hasUnsavedActiveGamers = !sameIds(
    draftActiveGamerIds,
    bootstrap.activeGameNightGamers.map((item) => item.gamerId),
  )
  const canCreateManualGame =
    !bootstrap.currentGame && !hasUnsavedActiveGamers && manualFormat !== null
  const canCreateRandomGame =
    !bootstrap.currentGame && !hasUnsavedActiveGamers && availableRandomFormats.length > 0
  const gamerNameStem = normalizeNameStem(gamerName)
  const gamerNameTakenLocally = bootstrap.gamers.some(
    (gamer) => normalizeNameStem(gamer.name) === gamerNameStem,
  )
  const canCreateGamer =
    gamerName.trim().length > 0 &&
    isValidNameStem(gamerName) &&
    !gamerNameTakenLocally &&
    (gamerPin.trim().length === 0 || /^\d{4}$/.test(gamerPin.trim()))

  function toggleActiveGamerDraft(gamerId: string): void {
    if (currentGameGamerIds.has(gamerId)) return
    setDraftActiveGamerIds((current) =>
      current.includes(gamerId)
        ? current.filter((item) => item !== gamerId)
        : [...current, gamerId],
    )
  }

  function setManualAssignment(gamerId: string, next: 'home' | 'away' | 'bench'): void {
    setManualAssignments((current) => ({
      ...current,
      [gamerId]: next,
    }))
  }

  function startEditingGamer(gamer: Gamer): void {
    setEditingGamerId(gamer.id)
    setEditingName(gamer.name)
    setEditingRating(String(gamer.rating))
    setEditingCurrentPin('')
    setEditingNextPin('')
  }

  async function saveGamerDetails(): Promise<void> {
    if (!editingGamerId) return
    const normalized = normalizeNameStem(editingName)
    if (!isValidNameStem(editingName)) return
    if (
      bootstrap.gamers.some(
        (gamer) => gamer.id !== editingGamerId && normalizeNameStem(gamer.name) === normalized,
      )
    ) {
      return
    }
    if (editingCurrentPin.trim().length > 0 && !/^\d{4}$/.test(editingCurrentPin.trim())) {
      return
    }
    if (editingNextPin.trim().length > 0 && !/^\d{4}$/.test(editingNextPin.trim())) {
      return
    }

    await onUpdateGamerDetails(editingGamerId, {
      name: editingName.trim(),
      rating: Number.parseInt(editingRating, 10),
      currentPin: editingCurrentPin.trim() || null,
      pin: editingNextPin.trim() || null,
    })
    setEditingGamerId(null)
    setEditingCurrentPin('')
    setEditingNextPin('')
  }

  return (
    <>
      <section
        style={{
          marginTop: 20,
          padding: 22,
          borderRadius: 28,
          background: '#052e16',
          color: '#ecfdf5',
          boxShadow: '0 24px 60px rgba(5,46,22,0.2)',
        }}
      >
        <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: 0, opacity: 0.72, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.16em' }}>
              Active room
            </p>
            <h2 style={{ margin: '10px 0 6px', fontSize: 30 }}>{bootstrap.room.name}</h2>
            <p style={{ margin: 0, opacity: 0.78 }}>
              ID: <code>{bootstrap.room.id}</code>
              {bootstrap.room.hasPin ? ' • PIN protected' : ' • Open room'}
            </p>
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onRefresh()}
            style={{
              ...secondaryButtonStyle,
              alignSelf: 'flex-start',
              background: 'rgba(236,253,245,0.12)',
              color: '#ecfdf5',
              borderColor: 'rgba(236,253,245,0.2)',
            }}
          >
            {busy === 'refreshing-room' ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div
          style={{
            marginTop: 18,
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}
        >
          <MiniStat label="Gamers" value={String(bootstrap.gamers.length)} />
          <MiniStat
            label="Active game night"
            value={
              bootstrap.activeGameNight
                ? bootstrap.currentGame
                  ? `${GAME_FORMATS[bootstrap.currentGame.format].label} live`
                  : `${bootstrap.activeGameNightGamers.length} ready`
                : 'Not started'
            }
          />
          <MiniStat
            label="Session"
            value={`until ${formatLocal(bootstrap.session.expiresAt, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}`}
          />
        </div>
      </section>

      <section
        style={{
          marginTop: 18,
          display: 'grid',
          gap: 14,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        <Panel
          title={bootstrap.activeGameNight ? 'Game night live' : 'Start game night'}
          subtitle={
            bootstrap.activeGameNight
              ? `Started ${formatRelative(bootstrap.activeGameNight.startedAt)}`
              : 'This uses the currently active gamers in the room.'
          }
        >
          {bootstrap.activeGameNight ? (
            <div
              style={{
                padding: 14,
                borderRadius: 18,
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
              }}
            >
              <strong>
                {bootstrap.currentGame
                  ? `${GAME_FORMATS[bootstrap.currentGame.format].label} currently on`
                  : `${bootstrap.activeGameNightGamers.length} gamers in the live pool`}
              </strong>
              <p style={{ margin: '8px 0 0', fontSize: 14, opacity: 0.75 }}>
                Re-entry can now forward straight into the active room context.
              </p>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void onStartGameNight()}
              style={primaryButtonStyle}
            >
              {busy === 'starting-game-night' ? 'Starting...' : 'Start game night'}
            </button>
          )}
        </Panel>

        <Panel title="Add gamer" subtitle="New gamers appear in the room roster immediately.">
          <Field label="Avatar">
            <AvatarPicker
              kind="gamer"
              value={gamerAvatarUrl}
              onChange={onChangeGamerAvatar}
              disabled={busy !== null}
            />
          </Field>
          <Field label="Name">
            <input
              value={gamerName}
              onChange={(event) => onChangeGamerName(event.target.value)}
              placeholder="Alice"
              style={inputStyle}
            />
          </Field>
          <Field label="Rating">
            <select
              value={gamerRating}
              onChange={(event) => onChangeGamerRating(event.target.value)}
              style={inputStyle}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Optional edit PIN">
            <input
              value={gamerPin}
              onChange={(event) => onChangeGamerPin(event.target.value)}
              placeholder="4 digits"
              inputMode="numeric"
              maxLength={4}
              style={inputStyle}
            />
          </Field>
          <p style={{ margin: '0 0 12px', fontSize: 13, opacity: 0.7 }}>
            Names compare by stem: case, spaces, and punctuation are ignored.
          </p>
          {!isValidNameStem(gamerName) && gamerName.trim().length > 0 ? (
            <InlineNotice tone="warn" message="Enter at least one letter or digit in the gamer name." />
          ) : null}
          {gamerNameTakenLocally ? (
            <InlineNotice tone="warn" message="That gamer name stem already exists in this room." />
          ) : null}
          {gamerPin.trim().length > 0 && !/^\d{4}$/.test(gamerPin.trim()) ? (
            <InlineNotice tone="warn" message="Gamer PIN must be exactly 4 digits." />
          ) : null}
          <button
            type="button"
            disabled={busy !== null || !canCreateGamer}
            onClick={() => void onCreateGamer()}
            style={secondaryButtonStyle}
          >
            {busy === 'creating-gamer' ? 'Adding...' : 'Add gamer'}
          </button>
        </Panel>
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
          <Panel
            title="Game night roster"
            subtitle="Pick who is in the live pool. Locked gamers are already in the current game."
          >
            <div style={{ display: 'grid', gap: 10 }}>
              {activeRoomGamers.map((gamer) => {
                const selected = draftActiveGamerIds.includes(gamer.id)
                const locked = currentGameGamerIds.has(gamer.id)
                return (
                  <button
                    key={gamer.id}
                    type="button"
                    disabled={busy !== null || locked}
                    onClick={() => toggleActiveGamerDraft(gamer.id)}
                    style={{
                      textAlign: 'left',
                      borderRadius: 18,
                      padding: 14,
                      border: `1px solid ${selected ? '#22c55e' : '#bbf7d0'}`,
                      background: selected ? '#ecfdf5' : '#ffffff',
                      color: '#052e16',
                      cursor: locked ? 'not-allowed' : 'pointer',
                      opacity: locked ? 0.7 : 1,
                    }}
                  >
                    <strong style={{ display: 'block', fontSize: 16 }}>{gamer.name}</strong>
                    <span style={{ fontSize: 13, opacity: 0.72 }}>
                      Rating {gamer.rating}
                      {locked ? ' • locked in current game' : selected ? ' • in live pool' : ' • out'}
                    </span>
                  </button>
                )
              })}
            </div>
            <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 14, opacity: 0.72 }}>
                {draftActiveGamerIds.length} gamers selected for the live pool.
              </div>
              <button
                type="button"
                disabled={busy !== null || !hasUnsavedActiveGamers || draftActiveGamerIds.length < 2}
                onClick={() =>
                  bootstrap.activeGameNight
                    ? void onSaveActiveGameNightGamers(
                        bootstrap.activeGameNight.id,
                        draftActiveGamerIds,
                      )
                    : undefined
                }
                style={secondaryButtonStyle}
              >
                {busy === 'saving-active-gamers' ? 'Saving roster...' : 'Save live pool'}
              </button>
            </div>
          </Panel>

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
                              <div>
                                <strong style={{ display: 'block', fontSize: 16 }}>{gamer.name}</strong>
                                <span style={{ fontSize: 13, opacity: 0.72 }}>
                                  {assignment === 'bench'
                                    ? 'Waiting'
                                    : assignment === 'home'
                                      ? 'Home side'
                                      : 'Away side'}
                                </span>
                              </div>
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
        </section>
      ) : null}

      <section style={{ marginTop: 18 }}>
        <Panel
          title="Roster"
          subtitle="Dots show who is playing now, who is active but sitting out, and who is inactive."
        >
          <div style={{ display: 'grid', gap: 10 }}>
            {bootstrap.gamers.length === 0 ? (
              <div
                style={{
                  padding: 18,
                  borderRadius: 18,
                  background: '#f0fdf4',
                  border: '1px dashed #86efac',
                }}
              >
                No gamers yet. Add the first one above.
              </div>
            ) : (
              bootstrap.gamers.map((gamer) => {
                const statusDot = getRosterStatusDot({
                  gamer,
                  activeGameNightGamerIds,
                  currentGameGamerIds,
                  hasCurrentGame: bootstrap.currentGame !== null,
                })
                return (
                  <article
                    key={gamer.id}
                    style={{
                      position: 'relative',
                      borderRadius: 22,
                      padding: 16,
                      background: gamer.active ? '#ffffff' : '#f8fafc',
                      border: `1px solid ${gamer.active ? '#bbf7d0' : '#cbd5e1'}`,
                      boxShadow: '0 8px 24px rgba(5,46,22,0.06)',
                    }}
                  >
                    <span
                      aria-label={statusDot.ariaLabel}
                      style={{
                        position: 'absolute',
                        top: 12,
                        right: 12,
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        background: statusDot.background,
                        border: statusDot.border,
                        boxShadow: statusDot.boxShadow,
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <strong style={{ display: 'block', fontSize: 20 }}>{gamer.name}</strong>
                        <span style={{ fontSize: 14, opacity: 0.72 }}>
                          Rating {gamer.rating} • {gamer.active ? 'Available' : 'Inactive'}
                          {gamer.hasPin ? ' • PIN protected' : ' • No PIN'}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gap: 8 }}>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void onToggleGamer(gamer)}
                          style={gamer.active ? secondaryButtonStyle : primaryButtonStyle}
                        >
                          {busy === 'updating-gamer'
                            ? 'Saving...'
                            : gamer.active
                              ? 'Set inactive'
                              : 'Reactivate'}
                        </button>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            editingGamerId === gamer.id
                              ? setEditingGamerId(null)
                              : startEditingGamer(gamer)
                          }
                          style={compactButtonStyle}
                        >
                          {editingGamerId === gamer.id ? 'Close edit' : 'Edit details'}
                        </button>
                      </div>
                    </div>
                    {editingGamerId === gamer.id ? (
                      <div
                        style={{
                          marginTop: 14,
                          paddingTop: 14,
                          borderTop: '1px solid #dcfce7',
                          display: 'grid',
                          gap: 10,
                        }}
                      >
                        <Field label="Name">
                          <input
                            value={editingName}
                            onChange={(event) => setEditingName(event.target.value)}
                            style={inputStyle}
                          />
                        </Field>
                        <Field label="Rating">
                          <select
                            value={editingRating}
                            onChange={(event) => setEditingRating(event.target.value)}
                            style={inputStyle}
                          >
                            {[1, 2, 3, 4, 5].map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </Field>
                        {gamer.hasPin ? (
                          <Field label="Current PIN">
                            <input
                              value={editingCurrentPin}
                              onChange={(event) => setEditingCurrentPin(event.target.value)}
                              inputMode="numeric"
                              maxLength={4}
                              placeholder="Current 4-digit PIN"
                              style={inputStyle}
                            />
                          </Field>
                        ) : null}
                        <Field label={gamer.hasPin ? 'New PIN (leave blank to clear)' : 'Set PIN'}>
                          <input
                            value={editingNextPin}
                            onChange={(event) => setEditingNextPin(event.target.value)}
                            inputMode="numeric"
                            maxLength={4}
                            placeholder={gamer.hasPin ? 'Blank clears PIN' : 'Optional 4-digit PIN'}
                            style={inputStyle}
                          />
                        </Field>
                        {!isValidNameStem(editingName) && editingName.trim().length > 0 ? (
                          <InlineNotice tone="warn" message="Enter at least one letter or digit in the gamer name." />
                        ) : null}
                        {bootstrap.gamers.some(
                          (item) =>
                            item.id !== gamer.id &&
                            normalizeNameStem(item.name) === normalizeNameStem(editingName),
                        ) ? (
                          <InlineNotice tone="warn" message="That gamer name stem is already taken." />
                        ) : null}
                        {editingCurrentPin.trim().length > 0 &&
                        !/^\d{4}$/.test(editingCurrentPin.trim()) ? (
                          <InlineNotice tone="warn" message="Current PIN must be exactly 4 digits." />
                        ) : null}
                        {editingNextPin.trim().length > 0 &&
                        !/^\d{4}$/.test(editingNextPin.trim()) ? (
                          <InlineNotice tone="warn" message="New PIN must be exactly 4 digits." />
                        ) : null}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void saveGamerDetails()}
                            style={primaryButtonStyle}
                          >
                            {busy === 'updating-gamer' ? 'Saving...' : 'Save gamer'}
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => setEditingGamerId(null)}
                            style={secondaryButtonStyle}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                )
              })
            )}
          </div>
        </Panel>
      </section>
    </>
  )
}

function CurrentGameCard({
  busy,
  currentGame,
  gamers,
  onInterruptGame,
  onRecordGameResult,
}: {
  busy: BusyState
  currentGame: CurrentGame
  gamers: ReadonlyArray<Gamer>
  onInterruptGame: (request: InterruptCurrentGameRequest) => Promise<void>
  onRecordGameResult: (request: RecordCurrentGameResultRequest) => Promise<void>
}) {
  const [homeScore, setHomeScore] = useState('')
  const [awayScore, setAwayScore] = useState('')
  const [interruptComment, setInterruptComment] = useState('')
  const trimmedHomeScore = homeScore.trim()
  const trimmedAwayScore = awayScore.trim()
  const hasScoreEntry = trimmedHomeScore.length > 0 || trimmedAwayScore.length > 0
  const validHomeScore = trimmedHomeScore.length === 0 || /^\d+$/.test(trimmedHomeScore)
  const validAwayScore = trimmedAwayScore.length === 0 || /^\d+$/.test(trimmedAwayScore)
  const scorePairReady =
    validHomeScore &&
    validAwayScore &&
    ((trimmedHomeScore.length === 0 && trimmedAwayScore.length === 0) ||
      (trimmedHomeScore.length > 0 && trimmedAwayScore.length > 0))

  async function submitResult(result: 'home' | 'away' | 'draw'): Promise<void> {
    if (!scorePairReady) return
    const nextHomeScore = trimmedHomeScore.length > 0 ? Number.parseInt(trimmedHomeScore, 10) : null
    const nextAwayScore = trimmedAwayScore.length > 0 ? Number.parseInt(trimmedAwayScore, 10) : null
    await onRecordGameResult({
      result,
      homeScore: nextHomeScore,
      awayScore: nextAwayScore,
    })
    setHomeScore('')
    setAwayScore('')
    setInterruptComment('')
  }

  async function submitInterrupt(): Promise<void> {
    await onInterruptGame({ comment: interruptComment.trim() || null })
    setInterruptComment('')
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 18,
          background: '#ecfdf5',
          border: '1px solid #86efac',
        }}
      >
        <strong style={{ display: 'block', fontSize: 18 }}>
          {GAME_FORMATS[currentGame.format].label} active now
        </strong>
        <span style={{ fontSize: 14, opacity: 0.72 }}>
          {currentGame.allocationMode === 'manual'
            ? 'Hand-picked teams'
            : `Random via ${currentGame.selectionStrategyId}`}
        </span>
      </div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
        <TeamColumn
          title="Home"
          gamerIds={currentGame.homeGamerIds}
          gamers={gamers}
        />
        <TeamColumn
          title="Away"
          gamerIds={currentGame.awayGamerIds}
          gamers={gamers}
        />
      </div>
      <div
        style={{
          padding: 14,
          borderRadius: 18,
          background: '#ffffff',
          border: '1px solid #d1fae5',
          display: 'grid',
          gap: 12,
        }}
      >
        <strong style={{ fontSize: 16 }}>Finish game</strong>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Home score">
            <input
              value={homeScore}
              onChange={(event) => setHomeScore(event.target.value)}
              inputMode="numeric"
              placeholder="Optional"
              style={inputStyle}
            />
          </Field>
          <Field label="Away score">
            <input
              value={awayScore}
              onChange={(event) => setAwayScore(event.target.value)}
              inputMode="numeric"
              placeholder="Optional"
              style={inputStyle}
            />
          </Field>
        </div>
        {!scorePairReady && hasScoreEntry ? (
          <InlineNotice tone="warn" message="Enter both scores or leave both blank." />
        ) : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <button
            type="button"
            disabled={busy !== null || !scorePairReady}
            onClick={() => void submitResult('home')}
            style={primaryButtonStyle}
          >
            {busy === 'recording-game' ? 'Saving...' : 'Home win'}
          </button>
          <button
            type="button"
            disabled={busy !== null || !scorePairReady}
            onClick={() => void submitResult('draw')}
            style={secondaryButtonStyle}
          >
            {busy === 'recording-game' ? 'Saving...' : 'Draw'}
          </button>
          <button
            type="button"
            disabled={busy !== null || !scorePairReady}
            onClick={() => void submitResult('away')}
            style={primaryButtonStyle}
          >
            {busy === 'recording-game' ? 'Saving...' : 'Away win'}
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.72 }}>
          Scores are optional, but if you enter them they must match the winner you pick.
        </p>
      </div>
      <div
        style={{
          padding: 14,
          borderRadius: 18,
          background: '#fffbeb',
          border: '1px solid #fcd34d',
          display: 'grid',
          gap: 12,
        }}
      >
        <strong style={{ fontSize: 16 }}>Interrupt game</strong>
        <Field label="Comment">
          <input
            value={interruptComment}
            onChange={(event) => setInterruptComment(event.target.value)}
            placeholder="Optional note"
            maxLength={280}
            style={inputStyle}
          />
        </Field>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void submitInterrupt()}
          style={secondaryButtonStyle}
        >
          {busy === 'interrupting-game' ? 'Interrupting...' : 'Interrupt game'}
        </button>
      </div>
    </div>
  )
}

function TeamColumn({
  title,
  gamerIds,
  gamers,
}: {
  title: string
  gamerIds: readonly string[]
  gamers: ReadonlyArray<Gamer>
}) {
  return (
    <div
      style={{
        borderRadius: 18,
        padding: 14,
        background: '#ffffff',
        border: '1px solid #d1fae5',
      }}
    >
      <strong style={{ display: 'block', marginBottom: 10 }}>{title}</strong>
      <div style={{ display: 'grid', gap: 8 }}>
        {gamerIds.map((gamerId) => (
          <div key={gamerId} style={{ fontSize: 14 }}>
            {gamers.find((gamer) => gamer.id === gamerId)?.name ?? gamerId}
          </div>
        ))}
      </div>
    </div>
  )
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <section
      style={{
        padding: 20,
        borderRadius: 24,
        background: 'rgba(255,255,255,0.82)',
        border: '1px solid rgba(5,46,22,0.08)',
        boxShadow: '0 14px 36px rgba(5,46,22,0.08)',
      }}
    >
      <h3 style={{ margin: 0, fontSize: 24 }}>{title}</h3>
      <p style={{ margin: '8px 0 16px', fontSize: 14, opacity: 0.7 }}>{subtitle}</p>
      {children}
    </section>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label style={{ display: 'grid', gap: 6, marginBottom: 12, fontSize: 14 }}>
      <span style={{ opacity: 0.78 }}>{label}</span>
      {children}
    </label>
  )
}

function AvatarPicker({
  kind,
  value,
  onChange,
  disabled,
  size = 72,
}: {
  kind: 'gamer' | 'room' | 'club' | 'fc_player'
  value: string | null
  onChange: (next: string | null) => void
  disabled?: boolean
  size?: number
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const preview = value ?? defaultAvatar(kind)

  async function handleFile(file: File | null): Promise<void> {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const dataUrl = await imageFileToAvatarDataUrl(file)
      onChange(dataUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <img
        src={preview}
        alt="Avatar preview"
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          border: '1px solid #bbf7d0',
          background: '#ffffff',
        }}
      />
      <div style={{ display: 'grid', gap: 6, flex: 1, minWidth: 0 }}>
        <label
          style={{
            ...compactButtonStyle,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: disabled || busy ? 0.5 : 1,
            cursor: disabled || busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Processing…' : value ? 'Replace image' : 'Choose image'}
          <input
            type="file"
            accept="image/*"
            disabled={disabled || busy}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null
              void handleFile(file)
              event.target.value = ''
            }}
            style={{ display: 'none' }}
          />
        </label>
        {value ? (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => onChange(null)}
            style={{ ...compactButtonStyle, background: '#fef2f2', color: '#991b1b' }}
          >
            Remove
          </button>
        ) : null}
        {error ? (
          <span style={{ fontSize: 12, color: '#991b1b' }}>{error}</span>
        ) : null}
      </div>
    </div>
  )
}

function StatusCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'light' | 'warn'
}) {
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 20,
        background: tone === 'warn' ? '#fef2f2' : 'rgba(255,255,255,0.78)',
        border: `1px solid ${tone === 'warn' ? '#fecaca' : 'rgba(5,46,22,0.08)'}`,
      }}
    >
      <p style={{ margin: 0, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', opacity: 0.6 }}>
        {label}
      </p>
      <p style={{ margin: '6px 0 0', fontSize: 15 }}>{value}</p>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 18,
        background: 'rgba(236,253,245,0.08)',
        border: '1px solid rgba(236,253,245,0.12)',
      }}
    >
      <p style={{ margin: 0, fontSize: 12, opacity: 0.72, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        {label}
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 18 }}>{value}</p>
    </div>
  )
}

function InlineNotice({
  tone,
  message,
}: {
  tone: 'warn' | 'info'
  message: string
}) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 14,
        background: tone === 'warn' ? '#fffbeb' : '#eff6ff',
        border: `1px solid ${tone === 'warn' ? '#fcd34d' : '#93c5fd'}`,
        fontSize: 13,
      }}
    >
      {message}
    </div>
  )
}

function buildManualAssignments(
  currentGame: CurrentGame | null,
): Record<string, 'home' | 'away' | 'bench'> {
  if (!currentGame) return {}
  const next: Record<string, 'home' | 'away' | 'bench'> = {}
  for (const gamerId of currentGame.homeGamerIds) next[gamerId] = 'home'
  for (const gamerId of currentGame.awayGamerIds) next[gamerId] = 'away'
  return next
}

function getRosterStatusDot({
  gamer,
  activeGameNightGamerIds,
  currentGameGamerIds,
  hasCurrentGame,
}: {
  gamer: Gamer
  activeGameNightGamerIds: ReadonlySet<string>
  currentGameGamerIds: ReadonlySet<string>
  hasCurrentGame: boolean
}): {
  ariaLabel: string
  background: string
  border: string
  boxShadow: string
} {
  if (hasCurrentGame) {
    if (currentGameGamerIds.has(gamer.id)) {
      return {
        ariaLabel: `${gamer.name} is playing in the current game`,
        background: '#22c55e',
        border: '1px solid #16a34a',
        boxShadow: '0 0 0 4px rgba(34,197,94,0.14)',
      }
    }
    if (gamer.active) {
      return {
        ariaLabel: `${gamer.name} is active but sitting out the current game`,
        background: '#cbd5e1',
        border: '1px solid #94a3b8',
        boxShadow: '0 0 0 4px rgba(148,163,184,0.16)',
      }
    }
    return {
      ariaLabel: `${gamer.name} is inactive`,
      background: '#ffffff',
      border: '1px solid #cbd5e1',
      boxShadow: '0 0 0 4px rgba(203,213,225,0.16)',
    }
  }

  if (activeGameNightGamerIds.has(gamer.id)) {
    return {
      ariaLabel: `${gamer.name} is active in the current game night`,
      background: '#22c55e',
      border: '1px solid #16a34a',
      boxShadow: '0 0 0 4px rgba(34,197,94,0.14)',
    }
  }

  return {
    ariaLabel: gamer.active ? `${gamer.name} is active` : `${gamer.name} is inactive`,
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    boxShadow: '0 0 0 4px rgba(203,213,225,0.16)',
  }
}

function sameIds(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) return false
  const a = [...left].sort()
  const b = [...right].sort()
  return a.every((value, index) => value === b[index])
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 16,
  border: '1px solid #bbf7d0',
  background: '#ffffff',
  padding: '14px 16px',
  fontSize: 16,
  color: '#052e16',
  boxSizing: 'border-box',
}

const primaryButtonStyle: React.CSSProperties = {
  border: '1px solid #166534',
  borderRadius: 18,
  padding: '14px 18px',
  background: '#166534',
  color: '#ecfdf5',
  fontSize: 15,
  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid #86efac',
  borderRadius: 18,
  padding: '14px 18px',
  background: '#f0fdf4',
  color: '#166534',
  fontSize: 15,
  cursor: 'pointer',
}

const compactButtonStyle: React.CSSProperties = {
  border: '1px solid #bbf7d0',
  borderRadius: 14,
  padding: '10px 12px',
  background: '#ffffff',
  color: '#166534',
  fontSize: 13,
  cursor: 'pointer',
}
