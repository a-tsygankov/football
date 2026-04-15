import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App } from './App.jsx'

function roomIdFromScoreboardUrl(url: string): string | null {
  const matched = /\/api\/rooms\/([^/]+)\/scoreboard$/.exec(url)
  return matched?.[1] ?? null
}

function emptyScoreboardResponse(roomId: string): Response {
  return new Response(
    JSON.stringify({
      roomId,
      gamerRows: [],
      gamerRowsWithoutTeamGames: [],
      gamerTeamRows: [],
      updatedAt: null,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('App shell', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    localStorage.clear()
    // The debug-console store reads its `everOpened` flag from localStorage
    // at module init and would otherwise leak across tests after the first
    // unlock. Reset it explicitly so every test starts with Settings hidden.
    const { __resetDebugConsoleForTests } = await import('./debug/console-store.js')
    __resetDebugConsoleForTests()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the room create and join entry points', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            workerVersion: '0.1.0',
            schemaVersion: 1,
            minClientVersion: '0.1.0',
            gitSha: null,
            builtAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )

    render(<App />)
    expect(
      screen.getByRole('heading', { name: /Room control for tonight's football session/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Create room/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Join room/i })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /FC26 Team Picker/i })).toBeInTheDocument()
  })

  it('creates a room and renders the roster screen', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input)
      const scoreboardRoomId = roomIdFromScoreboardUrl(url)
      if (scoreboardRoomId) return emptyScoreboardResponse(scoreboardRoomId)
      if (url.endsWith('/api/version')) {
        return new Response(
          JSON.stringify({
            workerVersion: '0.1.0',
            schemaVersion: 1,
            minClientVersion: '0.1.0',
            gitSha: null,
            builtAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/rooms') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            room: {
              id: 'room-1',
              name: 'Friday Night',
              avatarUrl: null,
              hasPin: false,
              defaultSelectionStrategy: 'uniform-random',
              createdAt: 1000,
              updatedAt: 1000,
            },
            gamers: [],
            activeGameNight: null,
            activeGameNightGamers: [],
            currentGame: null,
            session: {
              roomId: 'room-1',
              expiresAt: 2000,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`unexpected fetch ${url}`)
    }))

    render(<App />)
    fireEvent.change(screen.getAllByPlaceholderText(/Friday FC/i)[0]!, {
      target: { value: 'Friday Night' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /Create room/i })[0]!)

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Friday Night/i })).toBeInTheDocument(),
    )
    expect(screen.getByRole('heading', { name: /Roster/i })).toBeInTheDocument()
    expect(screen.getByText(/No gamers yet/i)).toBeInTheDocument()
  })

  it('restores the last room and shows an active game night banner', async () => {
    localStorage.setItem('fc26:last-room-id', 'room-9')
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = String(input)
      const scoreboardRoomId = roomIdFromScoreboardUrl(url)
      if (scoreboardRoomId) return emptyScoreboardResponse(scoreboardRoomId)
      if (url.endsWith('/api/version')) {
        return new Response(
          JSON.stringify({
            workerVersion: '9.9.9',
            schemaVersion: 1,
            minClientVersion: '0.1.0',
            gitSha: null,
            builtAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/rooms/room-9/bootstrap')) {
        return new Response(
          JSON.stringify({
            room: {
              id: 'room-9',
              name: 'Sunday Ladder',
              avatarUrl: null,
              hasPin: true,
              defaultSelectionStrategy: 'uniform-random',
              createdAt: 1000,
              updatedAt: 1000,
            },
            gamers: [
              {
                id: 'g1',
                roomId: 'room-9',
                name: 'Alice',
                rating: 5,
                active: true,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
            ],
            activeGameNight: {
              id: 'gn1',
              roomId: 'room-9',
              status: 'active',
              startedAt: Date.now() - 60_000,
              endedAt: null,
              lastGameAt: null,
              createdAt: 1000,
              updatedAt: 1000,
            },
            activeGameNightGamers: [
              {
                gameNightId: 'gn1',
                roomId: 'room-9',
                gamerId: 'g1',
                joinedAt: 1000,
                updatedAt: 1000,
              },
            ],
            currentGame: null,
            session: {
              roomId: 'room-9',
              expiresAt: Date.now() + 10_000,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`unexpected fetch ${url}`)
    }))

    render(<App />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Sunday Ladder/i })).toBeInTheDocument(),
    )
    expect(screen.getAllByText(/Active game night/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/1 ready/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Alice/i).length).toBeGreaterThan(0)

    // Settings is hidden by default — it exposes destructive controls and is
    // only meant for power-users. The triple-tap unlock on the bottom-nav
    // logo flips a persisted flag in the debug-console store; once unlocked
    // the Settings heading appears.
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull()
    const { useDebugConsole } = await import('./debug/console-store.js')
    useDebugConsole.getState().toggle() // simulates the third tap
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument(),
    )
  })

  it('reveals only relevant random formats for a two-gamer live pool', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input)
      const scoreboardRoomId = roomIdFromScoreboardUrl(url)
      if (scoreboardRoomId) return emptyScoreboardResponse(scoreboardRoomId)
      if (url.endsWith('/api/version')) {
        return new Response(
          JSON.stringify({
            workerVersion: '0.1.0',
            schemaVersion: 1,
            minClientVersion: '0.1.0',
            gitSha: null,
            builtAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/rooms') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            room: {
              id: 'room-2',
              name: 'Game Room',
              avatarUrl: null,
              hasPin: false,
              defaultSelectionStrategy: 'uniform-random',
              createdAt: 1000,
              updatedAt: 1000,
            },
            gamers: [
              {
                id: 'g1',
                roomId: 'room-2',
                name: 'Alice',
                rating: 5,
                active: true,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
              {
                id: 'g2',
                roomId: 'room-2',
                name: 'Bob',
                rating: 4,
                active: true,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
            ],
            activeGameNight: {
              id: 'gn2',
              roomId: 'room-2',
              status: 'active',
              startedAt: Date.now() - 60_000,
              endedAt: null,
              lastGameAt: null,
              createdAt: 1000,
              updatedAt: 1000,
            },
            activeGameNightGamers: [
              {
                gameNightId: 'gn2',
                roomId: 'room-2',
                gamerId: 'g1',
                joinedAt: 1000,
                updatedAt: 1000,
              },
              {
                gameNightId: 'gn2',
                roomId: 'room-2',
                gamerId: 'g2',
                joinedAt: 1000,
                updatedAt: 1000,
              },
            ],
            currentGame: null,
            session: {
              roomId: 'room-2',
              expiresAt: Date.now() + 10_000,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`unexpected fetch ${url}`)
    }))

    render(<App />)
    fireEvent.change(screen.getAllByPlaceholderText(/Friday FC/i)[0]!, {
      target: { value: 'Game Room' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /Create room/i })[0]!)

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Game creation/i })).toBeInTheDocument(),
    )
    expect(screen.queryByLabelText(/Format/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Random/i }))
    await waitFor(() => expect(screen.getByRole('option', { name: '1 vs 1' })).toBeInTheDocument())
    expect(screen.queryByRole('option', { name: '1 vs 2' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '2 vs 1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '2 vs 2' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Random strategy/i)).toBeInTheDocument()
  })

  it('hides 2 vs 2 random allocation until four active gamers are available', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input)
      const scoreboardRoomId = roomIdFromScoreboardUrl(url)
      if (scoreboardRoomId) return emptyScoreboardResponse(scoreboardRoomId)
      if (url.endsWith('/api/version')) {
        return new Response(
          JSON.stringify({
            workerVersion: '0.1.0',
            schemaVersion: 1,
            minClientVersion: '0.1.0',
            gitSha: null,
            builtAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/rooms') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            room: {
              id: 'room-4',
              name: 'Three Up',
              avatarUrl: null,
              hasPin: false,
              defaultSelectionStrategy: 'uniform-random',
              createdAt: 1000,
              updatedAt: 1000,
            },
            gamers: [
              {
                id: 'g1',
                roomId: 'room-4',
                name: 'Alice',
                rating: 5,
                active: true,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
              {
                id: 'g2',
                roomId: 'room-4',
                name: 'Bob',
                rating: 4,
                active: true,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
              {
                id: 'g3',
                roomId: 'room-4',
                name: 'Cara',
                rating: 3,
                active: true,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
            ],
            activeGameNight: {
              id: 'gn4',
              roomId: 'room-4',
              status: 'active',
              startedAt: Date.now() - 60_000,
              endedAt: null,
              lastGameAt: null,
              createdAt: 1000,
              updatedAt: 1000,
            },
            activeGameNightGamers: [
              {
                gameNightId: 'gn4',
                roomId: 'room-4',
                gamerId: 'g1',
                joinedAt: 1000,
                updatedAt: 1000,
              },
              {
                gameNightId: 'gn4',
                roomId: 'room-4',
                gamerId: 'g2',
                joinedAt: 1000,
                updatedAt: 1000,
              },
              {
                gameNightId: 'gn4',
                roomId: 'room-4',
                gamerId: 'g3',
                joinedAt: 1000,
                updatedAt: 1000,
              },
            ],
            currentGame: null,
            session: {
              roomId: 'room-4',
              expiresAt: Date.now() + 10_000,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`unexpected fetch ${url}`)
    }))

    render(<App />)
    fireEvent.change(screen.getAllByPlaceholderText(/Friday FC/i)[0]!, {
      target: { value: 'Three Up' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /Create room/i })[0]!)

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Game creation/i })).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /Random/i }))
    await waitFor(() => expect(screen.getByRole('option', { name: '1 vs 1' })).toBeInTheDocument())
    expect(screen.getByRole('option', { name: '1 vs 2' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '2 vs 1' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '2 vs 2' })).not.toBeInTheDocument()
  })

  it('shows roster dots for playing, sitting-out, and inactive gamers during a live game', async () => {
    localStorage.setItem('fc26:last-room-id', 'room-5')
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = String(input)
      const scoreboardRoomId = roomIdFromScoreboardUrl(url)
      if (scoreboardRoomId) return emptyScoreboardResponse(scoreboardRoomId)
      if (url.endsWith('/api/version')) {
        return new Response(
          JSON.stringify({
            workerVersion: '0.1.0',
            schemaVersion: 1,
            minClientVersion: '0.1.0',
            gitSha: null,
            builtAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/rooms/room-5/bootstrap')) {
        return new Response(
          JSON.stringify({
            room: {
              id: 'room-5',
              name: 'Roster States',
              avatarUrl: null,
              hasPin: false,
              defaultSelectionStrategy: 'uniform-random',
              createdAt: 1000,
              updatedAt: 1000,
            },
            gamers: [
              {
                id: 'g1',
                roomId: 'room-5',
                name: 'Alice',
                rating: 5,
                active: true,
                hasPin: false,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
              {
                id: 'g2',
                roomId: 'room-5',
                name: 'Bob',
                rating: 4,
                active: true,
                hasPin: false,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
              {
                id: 'g3',
                roomId: 'room-5',
                name: 'Cara',
                rating: 3,
                active: true,
                hasPin: false,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
              {
                id: 'g4',
                roomId: 'room-5',
                name: 'Dylan',
                rating: 2,
                active: false,
                hasPin: false,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
            ],
            activeGameNight: {
              id: 'gn5',
              roomId: 'room-5',
              status: 'active',
              startedAt: Date.now() - 60_000,
              endedAt: null,
              lastGameAt: null,
              createdAt: 1000,
              updatedAt: 1000,
            },
            activeGameNightGamers: [
              {
                gameNightId: 'gn5',
                roomId: 'room-5',
                gamerId: 'g1',
                joinedAt: 1000,
                updatedAt: 1000,
              },
              {
                gameNightId: 'gn5',
                roomId: 'room-5',
                gamerId: 'g2',
                joinedAt: 1000,
                updatedAt: 1000,
              },
              {
                gameNightId: 'gn5',
                roomId: 'room-5',
                gamerId: 'g3',
                joinedAt: 1000,
                updatedAt: 1000,
              },
            ],
            currentGame: {
              id: 'game-5',
              roomId: 'room-5',
              gameNightId: 'gn5',
              status: 'active',
              allocationMode: 'manual',
              format: '1v1',
              homeGamerIds: ['g1'],
              awayGamerIds: ['g2'],
              selectionStrategyId: 'manual',
              randomSeed: null,
              createdAt: 1000,
              updatedAt: 1000,
            },
            session: {
              roomId: 'room-5',
              expiresAt: Date.now() + 10_000,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`unexpected fetch ${url}`)
    }))

    render(<App />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Roster States/i })).toBeInTheDocument(),
    )
    expect(screen.getByLabelText('Alice is playing in the current game')).toBeInTheDocument()
    expect(screen.getByLabelText('Bob is playing in the current game')).toBeInTheDocument()
    expect(
      screen.getByLabelText('Cara is active but sitting out the current game'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Dylan is inactive')).toBeInTheDocument()
  })

  it('does not show green play-state dots when there is no active game', async () => {
    localStorage.setItem('fc26:last-room-id', 'room-6')
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = String(input)
      const scoreboardRoomId = roomIdFromScoreboardUrl(url)
      if (scoreboardRoomId) return emptyScoreboardResponse(scoreboardRoomId)
      if (url.endsWith('/api/version')) {
        return new Response(
          JSON.stringify({
            workerVersion: '0.1.0',
            schemaVersion: 1,
            minClientVersion: '0.1.0',
            gitSha: null,
            builtAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/rooms/room-6/bootstrap')) {
        return new Response(
          JSON.stringify({
            room: {
              id: 'room-6',
              name: 'Pool Only',
              avatarUrl: null,
              hasPin: false,
              defaultSelectionStrategy: 'uniform-random',
              createdAt: 1000,
              updatedAt: 1000,
            },
            gamers: [
              {
                id: 'g1',
                roomId: 'room-6',
                name: 'Alice',
                rating: 5,
                active: true,
                hasPin: false,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
              {
                id: 'g2',
                roomId: 'room-6',
                name: 'Bob',
                rating: 4,
                active: false,
                hasPin: false,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
            ],
            activeGameNight: {
              id: 'gn6',
              roomId: 'room-6',
              status: 'active',
              startedAt: Date.now() - 60_000,
              endedAt: null,
              lastGameAt: null,
              createdAt: 1000,
              updatedAt: 1000,
            },
            activeGameNightGamers: [
              {
                gameNightId: 'gn6',
                roomId: 'room-6',
                gamerId: 'g1',
                joinedAt: 1000,
                updatedAt: 1000,
              },
            ],
            currentGame: null,
            session: {
              roomId: 'room-6',
              expiresAt: Date.now() + 10_000,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`unexpected fetch ${url}`)
    }))

    render(<App />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Pool Only/i })).toBeInTheDocument(),
    )
    expect(screen.getByLabelText('Alice is active in the live pool')).toBeInTheDocument()
    expect(screen.queryByLabelText('Alice is playing in the current game')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Bob is inactive')).toBeInTheDocument()
  })

  it('renders the scoreboard for gamers and paired gamer teams', async () => {
    localStorage.setItem('fc26:last-room-id', 'room-7')
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/version')) {
        return new Response(
          JSON.stringify({
            workerVersion: '0.1.0',
            schemaVersion: 1,
            minClientVersion: '0.1.0',
            gitSha: null,
            builtAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/rooms/room-7/bootstrap')) {
        return new Response(
          JSON.stringify({
            room: {
              id: 'room-7',
              name: 'Scoreboard View',
              avatarUrl: null,
              hasPin: false,
              defaultSelectionStrategy: 'uniform-random',
              createdAt: 1000,
              updatedAt: 1000,
            },
            gamers: [
              {
                id: 'g1',
                roomId: 'room-7',
                name: 'Alice',
                rating: 5,
                active: true,
                hasPin: false,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
              {
                id: 'g2',
                roomId: 'room-7',
                name: 'Bob',
                rating: 4,
                active: true,
                hasPin: false,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
              {
                id: 'g3',
                roomId: 'room-7',
                name: 'Cara',
                rating: 3,
                active: true,
                hasPin: false,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
            ],
            activeGameNight: null,
            activeGameNightGamers: [],
            currentGame: null,
            session: {
              roomId: 'room-7',
              expiresAt: Date.now() + 10_000,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/rooms/room-7/scoreboard')) {
        return new Response(
          JSON.stringify({
            roomId: 'room-7',
            gamerRows: [
              {
                gamer: {
                  id: 'g1',
                  roomId: 'room-7',
                  name: 'Alice',
                  rating: 5,
                  active: true,
                  hasPin: false,
                  avatarUrl: null,
                  createdAt: 1000,
                  updatedAt: 1000,
                },
                stats: {
                  gamerId: 'g1',
                  roomId: 'room-7',
                  gamesPlayed: 4,
                  wins: 3,
                  draws: 0,
                  losses: 1,
                  goalsFor: 9,
                  goalsAgainst: 4,
                  lastEventId: 'ev-1',
                  updatedAt: 1100,
                },
                points: 9,
                winRate: 0.75,
                goalDiff: 5,
              },
              {
                gamer: {
                  id: 'g2',
                  roomId: 'room-7',
                  name: 'Bob',
                  rating: 4,
                  active: true,
                  hasPin: false,
                  avatarUrl: null,
                  createdAt: 1000,
                  updatedAt: 1000,
                },
                stats: {
                  gamerId: 'g2',
                  roomId: 'room-7',
                  gamesPlayed: 4,
                  wins: 2,
                  draws: 1,
                  losses: 1,
                  goalsFor: 7,
                  goalsAgainst: 5,
                  lastEventId: 'ev-2',
                  updatedAt: 1100,
                },
                points: 7,
                winRate: 0.5,
                goalDiff: 2,
              },
            ],
            gamerRowsWithoutTeamGames: [
              {
                gamer: {
                  id: 'g1',
                  roomId: 'room-7',
                  name: 'Alice',
                  rating: 5,
                  active: true,
                  hasPin: false,
                  avatarUrl: null,
                  createdAt: 1000,
                  updatedAt: 1000,
                },
                stats: {
                  gamerId: 'g1',
                  roomId: 'room-7',
                  gamesPlayed: 2,
                  wins: 2,
                  draws: 0,
                  losses: 0,
                  goalsFor: 4,
                  goalsAgainst: 1,
                  lastEventId: 'ev-4',
                  updatedAt: 1200,
                },
                points: 6,
                winRate: 1,
                goalDiff: 3,
              },
            ],
            gamerTeamRows: [
              {
                gamerTeamKey: 'g1:g2',
                members: [
                  {
                    id: 'g1',
                    roomId: 'room-7',
                    name: 'Alice',
                    rating: 5,
                    active: true,
                    hasPin: false,
                    avatarUrl: null,
                    createdAt: 1000,
                    updatedAt: 1000,
                  },
                  {
                    id: 'g2',
                    roomId: 'room-7',
                    name: 'Bob',
                    rating: 4,
                    active: true,
                    hasPin: false,
                    avatarUrl: null,
                    createdAt: 1000,
                    updatedAt: 1000,
                  },
                ],
                stats: {
                  gamerTeamKey: 'g1:g2',
                  roomId: 'room-7',
                  members: ['g1', 'g2'],
                  gamesPlayed: 3,
                  wins: 2,
                  draws: 0,
                  losses: 1,
                  goalsFor: 6,
                  goalsAgainst: 3,
                  lastEventId: 'ev-3',
                  updatedAt: 1100,
                },
                points: 6,
                winRate: 2 / 3,
                goalDiff: 3,
              },
            ],
            updatedAt: 1100,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`unexpected fetch ${url}`)
    }))

    render(<App />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Scoreboard View/i })).toBeInTheDocument(),
    )
    const scoreboardSection = screen.getByRole('heading', { name: 'Scoreboard' }).closest('section')
    expect(scoreboardSection).not.toBeNull()
    const scoreboard = within(scoreboardSection!)
    await waitFor(() => expect(scoreboard.getByText('Alice')).toBeInTheDocument())

    expect(
      scoreboard.getByText(
        /Best gamers and gamer teams\. Pair standings only count results earned together\./i,
      ),
    ).toBeInTheDocument()
    expect(
      scoreboard.getByText(/9 pts • 3-0-1 • 4 games • Win rate 75% • GD \+5/i),
    ).toBeInTheDocument()

    fireEvent.click(scoreboard.getByRole('button', { name: /Ignore team games/i }))
    expect(
      scoreboard.getByText(/Individual standings count only 1 vs 1 results\./i),
    ).toBeInTheDocument()
    expect(
      scoreboard.getByText(/6 pts • 2-0-0 • 2 games • Win rate 100% • GD \+3/i),
    ).toBeInTheDocument()

    fireEvent.click(scoreboard.getByRole('button', { name: /Gamer teams/i }))
    expect(scoreboard.getByText(/Alice \+ Bob|Bob \+ Alice/)).toBeInTheDocument()
    expect(scoreboard.getByText(/2-0-1 • 3 games • Win rate 67% • GD \+3/i)).toBeInTheDocument()
  })

  it('renders the teams and changes sections from the squad endpoints', async () => {
    localStorage.setItem('fc26:last-room-id', 'room-8')
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/version')) {
        return new Response(
          JSON.stringify({
            workerVersion: '0.1.0',
            schemaVersion: 1,
            minClientVersion: '0.1.0',
            gitSha: null,
            builtAt: new Date().toISOString(),
            latestSquadVersion: 'v2',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/rooms/room-8/bootstrap')) {
        return new Response(
          JSON.stringify({
            room: {
              id: 'room-8',
              name: 'Squad Browser',
              avatarUrl: null,
              hasPin: false,
              defaultSelectionStrategy: 'uniform-random',
              createdAt: 1000,
              updatedAt: 1000,
            },
            gamers: [],
            activeGameNight: null,
            activeGameNightGamers: [],
            currentGame: null,
            session: {
              roomId: 'room-8',
              expiresAt: Date.now() + 10_000,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/rooms/room-8/scoreboard')) {
        return emptyScoreboardResponse('room-8')
      }
      if (url.endsWith('/api/squads/versions')) {
        return new Response(
          JSON.stringify({
            versions: [
              {
                version: 'v2',
                releasedAt: 2000,
                ingestedAt: 2100,
                clubsBytes: 100,
                clubCount: 1,
                playerCount: 1,
                sourceUrl: 'https://example.com/v2.json',
                notes: null,
              },
              {
                version: 'v1',
                releasedAt: 1000,
                ingestedAt: 1100,
                clubsBytes: 90,
                clubCount: 1,
                playerCount: 1,
                sourceUrl: 'https://example.com/v1.json',
                notes: null,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/squads/v2/clubs')) {
        return new Response(
          JSON.stringify({
            version: 'v2',
            clubs: [
              {
                id: 1,
                name: 'Arsenal',
                shortName: 'ARS',
                leagueId: 100,
                leagueName: 'Premier League',
                leagueLogoUrl: 'https://example.com/premier.png',
                nationId: 14,
                overallRating: 85,
                attackRating: 84,
                midfieldRating: 85,
                defenseRating: 83,
                avatarUrl: null,
                logoUrl: 'https://example.com/arsenal.png',
                starRating: 4,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/squads/v1/clubs')) {
        return new Response(
          JSON.stringify({
            version: 'v1',
            clubs: [
              {
                id: 1,
                name: 'Arsenal',
                shortName: 'ARS',
                leagueId: 100,
                leagueName: 'Premier League',
                leagueLogoUrl: 'https://example.com/premier.png',
                nationId: 14,
                overallRating: 84,
                attackRating: 83,
                midfieldRating: 84,
                defenseRating: 82,
                avatarUrl: null,
                logoUrl: 'https://example.com/arsenal.png',
                starRating: 4,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/squads/v2/leagues')) {
        return new Response(
          JSON.stringify({
            version: 'v2',
            leagues: [
              {
                id: 100,
                name: 'Premier League',
                logoUrl: 'https://example.com/premier.png',
                clubCount: 1,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/squads/v2/players/1')) {
        return new Response(
          JSON.stringify({
            version: 'v2',
            clubId: 1,
            players: [
              {
                id: 7,
                clubId: 1,
                name: 'Bukayo Saka',
                avatarUrl: 'https://example.com/saka.png',
                position: 'RW',
                nationId: 14,
                overall: 87,
                attributes: {
                  pace: 90,
                  shooting: 83,
                  passing: 81,
                  dribbling: 89,
                  defending: 60,
                  physical: 72,
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/squads/v2/diff?from=v1')) {
        return new Response(
          JSON.stringify({
            fromVersion: 'v1',
            toVersion: 'v2',
            generatedAt: 2200,
            playerChanges: [
              {
                playerId: 7,
                clubId: 1,
                name: 'Bukayo Saka',
                changes: [{ field: 'overall', from: 86, to: 87 }],
              },
            ],
            clubChanges: [
              {
                clubId: 1,
                field: 'overallRating',
                from: 84,
                to: 85,
              },
            ],
            addedPlayers: [],
            removedPlayers: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`unexpected fetch ${url}`)
    }))

    render(<App />)

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Squad Browser/i })).toBeInTheDocument(),
    )
    const teamsSection = screen.getByRole('heading', { name: 'Teams' }).closest('section')
    expect(teamsSection).not.toBeNull()
    const teams = within(teamsSection!)
    // Teams panel now starts with no league selected — tap the Premier
    // League pill so the club grid renders. The select-based dropdown was
    // replaced by horizontally-scrollable `LeaguePills` for a compact UX,
    // so we drive it via the tab role the pills expose.
    const premierLeaguePill = await teams.findByRole('tab', {
      name: /Premier League/i,
    })
    fireEvent.click(premierLeaguePill)
    await waitFor(() => expect(teams.getAllByText('Arsenal').length).toBeGreaterThan(0))
    // There's no longer a default selected club — we have to click Arsenal
    // before the player list populates.
    const arsenalCard = teams
      .getAllByRole('button')
      .find((button) => within(button).queryByText('Arsenal'))
    expect(arsenalCard).toBeDefined()
    fireEvent.click(arsenalCard!)
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Bukayo Saka player avatar' })).toBeInTheDocument(),
    )
    expect(
      screen
        .getAllByRole('img', { name: 'Arsenal club logo' })
        .some((image) => image.getAttribute('src') === 'https://example.com/arsenal.png'),
    ).toBe(true)
    expect(screen.getByRole('img', { name: 'Bukayo Saka player avatar' })).toHaveAttribute(
      'src',
      'https://example.com/saka.png',
    )
    expect(screen.getByText(/Overall changed from 84 to 85/i)).toBeInTheDocument()
    expect(screen.getByText(/OVR 86 → 87/i)).toBeInTheDocument()
  })

  it('records the active game result and returns to game creation', async () => {
    localStorage.setItem('fc26:last-room-id', 'room-3')
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input)
      const scoreboardRoomId = roomIdFromScoreboardUrl(url)
      if (scoreboardRoomId) {
        return new Response(
          JSON.stringify({
            roomId: scoreboardRoomId,
            gamerRows: [
              {
                gamer: {
                  id: 'g1',
                  roomId: scoreboardRoomId,
                  name: 'Alice',
                  rating: 5,
                  active: true,
                  hasPin: false,
                  avatarUrl: null,
                  createdAt: 1000,
                  updatedAt: 1000,
                },
                stats: {
                  gamerId: 'g1',
                  roomId: scoreboardRoomId,
                  gamesPlayed: 1,
                  wins: 1,
                  draws: 0,
                  losses: 0,
                  goalsFor: 2,
                  goalsAgainst: 0,
                  lastEventId: 'ev-1',
                  updatedAt: 1000,
                },
                points: 3,
                winRate: 1,
                goalDiff: 2,
              },
            ],
            gamerRowsWithoutTeamGames: [
              {
                gamer: {
                  id: 'g1',
                  roomId: scoreboardRoomId,
                  name: 'Alice',
                  rating: 5,
                  active: true,
                  hasPin: false,
                  avatarUrl: null,
                  createdAt: 1000,
                  updatedAt: 1000,
                },
                stats: {
                  gamerId: 'g1',
                  roomId: scoreboardRoomId,
                  gamesPlayed: 1,
                  wins: 1,
                  draws: 0,
                  losses: 0,
                  goalsFor: 2,
                  goalsAgainst: 0,
                  lastEventId: 'ev-1',
                  updatedAt: 1000,
                },
                points: 3,
                winRate: 1,
                goalDiff: 2,
              },
            ],
            gamerTeamRows: [],
            updatedAt: 1000,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/version')) {
        return new Response(
          JSON.stringify({
            workerVersion: '0.1.0',
            schemaVersion: 1,
            minClientVersion: '0.1.0',
            gitSha: null,
            builtAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/rooms') && init?.method === 'POST') {
        throw new Error(`unexpected create room ${url}`)
      }
      if (url.endsWith('/api/rooms/room-3/bootstrap')) {
        return new Response(
          JSON.stringify({
            room: {
              id: 'room-3',
              name: 'Live Room',
              avatarUrl: null,
              hasPin: false,
              defaultSelectionStrategy: 'uniform-random',
              createdAt: 1000,
              updatedAt: 1000,
            },
            gamers: [
              {
                id: 'g1',
                roomId: 'room-3',
                name: 'Alice',
                rating: 5,
                active: true,
                hasPin: false,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
              {
                id: 'g2',
                roomId: 'room-3',
                name: 'Bob',
                rating: 4,
                active: true,
                hasPin: false,
                avatarUrl: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
            ],
            activeGameNight: {
              id: 'gn3',
              roomId: 'room-3',
              status: 'active',
              startedAt: Date.now() - 60_000,
              endedAt: null,
              lastGameAt: null,
              createdAt: 1000,
              updatedAt: 1000,
            },
            activeGameNightGamers: [
              {
                gameNightId: 'gn3',
                roomId: 'room-3',
                gamerId: 'g1',
                joinedAt: 1000,
                updatedAt: 1000,
              },
              {
                gameNightId: 'gn3',
                roomId: 'room-3',
                gamerId: 'g2',
                joinedAt: 1000,
                updatedAt: 1000,
              },
            ],
            currentGame: {
              id: 'game-3',
              roomId: 'room-3',
              gameNightId: 'gn3',
              status: 'active',
              allocationMode: 'manual',
              format: '1v1',
              homeGamerIds: ['g1'],
              awayGamerIds: ['g2'],
              selectionStrategyId: 'manual',
              randomSeed: null,
              createdAt: 1000,
              updatedAt: 1000,
            },
            session: {
              roomId: 'room-3',
              expiresAt: Date.now() + 10_000,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/rooms/room-3/game-nights/gn3/games/game-3/result')) {
        return new Response(
          JSON.stringify({
            currentGame: null,
            activeGameNight: {
              id: 'gn3',
              roomId: 'room-3',
              status: 'active',
              startedAt: Date.now() - 60_000,
              endedAt: null,
              lastGameAt: Date.now(),
              createdAt: 1000,
              updatedAt: Date.now(),
            },
            eventId: 'ev-1',
            eventType: 'game_recorded',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`unexpected fetch ${url}`)
    }))

    render(<App />)
    await waitFor(() => expect(screen.getByText(/Finish game/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Home win/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Create manual game/i })).toBeInTheDocument(),
    )
  })
})
