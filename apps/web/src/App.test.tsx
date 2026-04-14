import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
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
    expect(screen.getByText(/1 gamers in the live pool/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Alice/i).length).toBeGreaterThan(0)
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
    expect(screen.getByRole('heading', { name: 'Scoreboard' })).toBeInTheDocument()
    expect(
      screen.getByText(/Best gamers and gamer teams\. Pair standings only count results earned together\./i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        (_content, node) => node?.tagName === 'ARTICLE' && node.textContent?.includes('9 pts') === true,
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Ignore team games/i }))
    expect(screen.getByText(/Individual standings count only 1 vs 1 results\./i)).toBeInTheDocument()
    expect(
      screen.getByText(
        (_content, node) => node?.tagName === 'ARTICLE' && node.textContent?.includes('6 pts') === true,
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Gamer teams/i }))
    expect(screen.getByText(/Alice \+ Bob|Bob \+ Alice/)).toBeInTheDocument()
    expect(screen.getByText(/Win rate 67%/i)).toBeInTheDocument()
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
