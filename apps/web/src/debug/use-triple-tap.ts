import { useCallback, useRef } from 'react'

/**
 * Hook that detects a triple-tap within a short window. Returns a handler to
 * attach to the target element. Pure: no globals, no timers leaking if the
 * component unmounts between taps (the ref is reset on each unmount cycle).
 */
const WINDOW_MS = 600

export function useTripleTap(onTriple: () => void): () => void {
  const tapsRef = useRef<number[]>([])

  return useCallback(() => {
    const now = Date.now()
    const taps = tapsRef.current.filter((t) => now - t <= WINDOW_MS)
    taps.push(now)
    tapsRef.current = taps
    if (taps.length >= 3) {
      tapsRef.current = []
      onTriple()
    }
  }, [onTriple])
}
