import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetDebugConsoleForTests, useDebugConsole } from './console-store.js'

describe('useDebugConsole', () => {
  beforeEach(() => {
    __resetDebugConsoleForTests()
  })

  it('starts hidden and locked', () => {
    const state = useDebugConsole.getState()
    expect(state.open).toBe(false)
    expect(state.everOpened).toBe(false)
  })

  it('flips both `open` and `everOpened` when the console opens for the first time', () => {
    useDebugConsole.getState().toggle()
    const after = useDebugConsole.getState()
    expect(after.open).toBe(true)
    expect(after.everOpened).toBe(true)
  })

  it('keeps `everOpened` true after closing the console', () => {
    useDebugConsole.getState().toggle()
    useDebugConsole.getState().close()
    const after = useDebugConsole.getState()
    expect(after.open).toBe(false)
    expect(after.everOpened).toBe(true)
  })

  it('persists `everOpened` to localStorage so the unlock survives reloads', () => {
    useDebugConsole.getState().toggle()
    expect(localStorage.getItem('fc26:debug-console:ever-opened')).toBe('1')
  })

  it('starts with everOpened false on a fresh session even if localStorage flag is set', async () => {
    localStorage.setItem('fc26:debug-console:ever-opened', '1')
    // Settings should only appear after the user triple-taps in the
    // *current* session — not carry over from a previous page load.
    vi.resetModules()
    const { useDebugConsole: freshStore } = await import('./console-store.js')
    expect(freshStore.getState().everOpened).toBe(false)
  })
})
