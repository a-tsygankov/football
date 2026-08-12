import { useCallback, useEffect, useState } from 'react'

/**
 * The app's pages. Each is a full screen; there is no longer one long
 * scrollable surface holding all of them at once.
 */
export const ROUTES = ['game', 'scoreboard', 'wager', 'roster', 'teams', 'settings'] as const

export type Route = (typeof ROUTES)[number]

export const DEFAULT_ROUTE: Route = 'game'

function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value)
}

/** `#/wager` -> `wager`; anything unrecognised falls back to the default. */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '').split(/[?/]/)[0] ?? ''
  return isRoute(raw) ? raw : DEFAULT_ROUTE
}

/**
 * Hash-based routing, deliberately not a router library.
 *
 * Two reasons for the hash. The client is served as static assets under
 * /football/, so a real path like /football/wager would 404 unless the host
 * were configured with an SPA fallback — hash routes never reach the server at
 * all, which is one less thing to keep in sync across two origins during the
 * Cloudflare migration. And with six flat pages and no nested layouts, a
 * dependency would buy layout features this app has no use for.
 *
 * Back/forward still work, because each navigation is a real history entry.
 */
export function useHashRoute(): {
  route: Route
  navigate: (route: Route) => void
} {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? DEFAULT_ROUTE : parseHash(window.location.hash),
  )

  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    // The hash may have changed between first render and this effect.
    onChange()
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((next: Route) => {
    // Assigning the hash pushes a history entry, so Back returns to the
    // previous tab rather than leaving the app.
    window.location.hash = `#/${next}`
    // hashchange does not fire when the hash is unchanged, so set state
    // directly — otherwise re-tapping the current tab would appear to do
    // nothing while any in-page state stayed stale.
    setRoute(next)
  }, [])

  return { route, navigate }
}
