import { startTransition, useEffect, useMemo, useState } from 'react'
import {
  formatLocal,
  formatRelative,
  type Gamer,
  type RoomBootstrapResponse,
} from '@fc26/shared'
import { apiJson } from './lib/api.js'
import { logger } from './lib/logger.js'
import { APP_VERSION, type WorkerVersionInfo } from './lib/version.js'
import { BottomNav } from './components/BottomNav.jsx'
import { DebugConsole } from './debug/DebugConsole.jsx'

const LAST_ROOM_ID_KEY = 'fc26:last-room-id'

type BusyState =
  | 'creating-room'
  | 'joining-room'
  | 'refreshing-room'
  | 'creating-gamer'
  | 'updating-gamer'
  | 'starting-game-night'
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

  const activeGameNightGamerIds = useMemo(
    () => new Set((bootstrap?.activeGameNightGamers ?? []).map((item) => item.gamerId)),
    [bootstrap],
  )

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
          body: JSON.stringify({ pin: joinPin.trim() || null }),
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
          }),
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

  function applyBootstrap(next: RoomBootstrapResponse): void {
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
            activeGameNightGamerIds={activeGameNightGamerIds}
            onChangeGamerName={setGamerName}
            onChangeGamerRating={setGamerRating}
            onCreateGamer={createGamer}
            onRefresh={() => refreshRoom(bootstrap.room.id)}
            onStartGameNight={startGameNight}
            onToggleGamer={toggleGamer}
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
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void onCreateRoom()}
          style={primaryButtonStyle}
        >
          {busy === 'creating-room' ? 'Creating room...' : 'Create room'}
        </button>
      </Panel>

      <Panel title="Join room" subtitle="Re-enter by room id and optional PIN.">
        <Field label="Room id">
          <input
            value={joinRoomId}
            onChange={(event) => onJoinRoomId(event.target.value)}
            placeholder="Paste room id"
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
  activeGameNightGamerIds,
  onChangeGamerName,
  onChangeGamerRating,
  onCreateGamer,
  onRefresh,
  onStartGameNight,
  onToggleGamer,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  gamerName: string
  gamerRating: string
  activeGameNightGamerIds: ReadonlySet<string>
  onChangeGamerName: (value: string) => void
  onChangeGamerRating: (value: string) => void
  onCreateGamer: () => Promise<void>
  onRefresh: () => Promise<void>
  onStartGameNight: () => Promise<void>
  onToggleGamer: (gamer: Gamer) => Promise<void>
}) {
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
                ? `${bootstrap.activeGameNightGamers.length} live`
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
              <strong>{bootstrap.activeGameNightGamers.length} gamers playing now</strong>
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
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onCreateGamer()}
            style={secondaryButtonStyle}
          >
            {busy === 'creating-gamer' ? 'Adding...' : 'Add gamer'}
          </button>
        </Panel>
      </section>

      <section style={{ marginTop: 18 }}>
        <Panel
          title="Roster"
          subtitle="Green dots mark gamers currently active in the game night."
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
              bootstrap.gamers.map((gamer) => (
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
                  {activeGameNightGamerIds.has(gamer.id) ? (
                    <span
                      aria-label={`${gamer.name} is active in the current game night`}
                      style={{
                        position: 'absolute',
                        top: 12,
                        right: 12,
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        background: '#22c55e',
                        boxShadow: '0 0 0 4px rgba(34,197,94,0.14)',
                      }}
                    />
                  ) : null}
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <strong style={{ display: 'block', fontSize: 20 }}>{gamer.name}</strong>
                      <span style={{ fontSize: 14, opacity: 0.72 }}>
                        Rating {gamer.rating} • {gamer.active ? 'Available' : 'Benched'}
                      </span>
                    </div>
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
                  </div>
                </article>
              ))
            )}
          </div>
        </Panel>
      </section>
    </>
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
