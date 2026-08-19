import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useOnlineStatus } from './useOnlineStatus.js'

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}

afterEach(() => setOnline(true))

describe('useOnlineStatus', () => {
  it('reports online when the browser is connected', () => {
    setOnline(true)

    const { result } = renderHook(() => useOnlineStatus())

    expect(result.current).toBe(true)
  })

  it('reports offline when the browser starts up with no connection', () => {
    // The installed PWA opening cold on the tube: the shell comes from the
    // precache, so we render, and this is what tells the gamer why the
    // room will not load.
    setOnline(false)

    const { result } = renderHook(() => useOnlineStatus())

    expect(result.current).toBe(false)
  })

  it('follows the connection dropping while the app is open', () => {
    setOnline(true)
    const { result } = renderHook(() => useOnlineStatus())

    act(() => {
      setOnline(false)
      window.dispatchEvent(new Event('offline'))
    })

    expect(result.current).toBe(false)
  })

  it('follows the connection coming back', () => {
    setOnline(false)
    const { result } = renderHook(() => useOnlineStatus())

    act(() => {
      setOnline(true)
      window.dispatchEvent(new Event('online'))
    })

    expect(result.current).toBe(true)
  })

  it('stops listening once unmounted', () => {
    setOnline(true)
    const { result, unmount } = renderHook(() => useOnlineStatus())
    unmount()

    act(() => {
      setOnline(false)
      window.dispatchEvent(new Event('offline'))
    })

    expect(result.current).toBe(true)
  })
})
