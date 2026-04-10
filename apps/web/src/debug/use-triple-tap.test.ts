import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTripleTap } from './use-triple-tap.js'

describe('useTripleTap', () => {
  it('fires callback on the third tap inside the window', () => {
    const cb = vi.fn()
    const { result } = renderHook(() => useTripleTap(cb))
    act(() => result.current())
    act(() => result.current())
    expect(cb).not.toHaveBeenCalled()
    act(() => result.current())
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('resets after a successful triple-tap', () => {
    const cb = vi.fn()
    const { result } = renderHook(() => useTripleTap(cb))
    act(() => result.current())
    act(() => result.current())
    act(() => result.current())
    act(() => result.current())
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('ignores taps outside the window', () => {
    vi.useFakeTimers()
    const cb = vi.fn()
    const { result } = renderHook(() => useTripleTap(cb))
    act(() => result.current())
    vi.setSystemTime(new Date(Date.now() + 2000))
    act(() => result.current())
    act(() => result.current())
    expect(cb).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
