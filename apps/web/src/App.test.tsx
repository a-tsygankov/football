import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { App } from './App.jsx'

describe('App shell', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the Phase 0 heading and bottom nav', () => {
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
    expect(screen.getByRole('heading', { name: /FC 26 Team Picker/i })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /FC26 Team Picker/i })).toBeInTheDocument()
  })

  it('shows worker version after the fetch resolves', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            workerVersion: '9.9.9',
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
    await waitFor(() =>
      expect(screen.getByText(/v9\.9\.9/)).toBeInTheDocument(),
    )
  })
})
