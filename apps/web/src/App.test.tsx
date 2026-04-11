import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from './App.jsx'

describe('App shell', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
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

  it('reveals random game controls only after switching modes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
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
    expect(screen.getByLabelText(/Format/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Random strategy/i)).toBeInTheDocument()
  })
})
