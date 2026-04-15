import { useCallback, useRef, useState } from 'react'

/**
 * Two-control "link until both touched" state.
 *
 * Two related controls (e.g. the home/away team-rating sliders in Game
 * Creation) start out linked: changing one mirrors the change to the other.
 * Once the user touches the *second* control of the pair, the link breaks
 * and the controls move independently from then on. Re-mounting the
 * component (or switching rooms) resets the pair.
 *
 * The two controls always share the same value type — pick `T` so it covers
 * the union (`'league' | 'international'`, `number | 'all'`, ...).
 *
 * Implementation note: `linkedRef` mirrors the linked state synchronously so
 * the second `setX` inside the same React batch sees the latest value, even
 * before the next render commits.
 */
export interface LinkedPair<T> {
  readonly home: T
  readonly away: T
  readonly linked: boolean
  setHome: (next: T) => void
  setAway: (next: T) => void
}

export function useLinkedPair<T>(initial: T): LinkedPair<T> {
  const [home, setHomeRaw] = useState<T>(initial)
  const [away, setAwayRaw] = useState<T>(initial)
  const [linked, setLinked] = useState(true)

  // First side the user touched; null until any input. Once the *other* side
  // is touched the link breaks. Stored in a ref so the setters don't need to
  // be re-created every time React re-renders.
  const firstTouchedRef = useRef<'home' | 'away' | null>(null)
  const linkedRef = useRef(true)

  const setHome = useCallback((next: T) => {
    setHomeRaw(next)
    if (linkedRef.current) {
      setAwayRaw(next)
    }
    if (firstTouchedRef.current === null) {
      firstTouchedRef.current = 'home'
    } else if (firstTouchedRef.current === 'away' && linkedRef.current) {
      linkedRef.current = false
      setLinked(false)
    }
  }, [])

  const setAway = useCallback((next: T) => {
    setAwayRaw(next)
    if (linkedRef.current) {
      setHomeRaw(next)
    }
    if (firstTouchedRef.current === null) {
      firstTouchedRef.current = 'away'
    } else if (firstTouchedRef.current === 'home' && linkedRef.current) {
      linkedRef.current = false
      setLinked(false)
    }
  }, [])

  return { home, away, linked, setHome, setAway }
}
