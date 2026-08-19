import { useSyncExternalStore } from 'react'

/**
 * Whether the browser currently has a network connection.
 *
 * Only meaningful once there is a service worker: before it, a cold start
 * with no network never reached React at all. `navigator.onLine` is a
 * coarse signal (it says "there is a link", not "the worker answers"), but
 * a false reading is exactly the case worth calling out — the app shell
 * came from the precache and nothing behind /api is reachable.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    // Server snapshot: assume connected so SSR/prerender never renders the
    // offline notice into static markup.
    () => true,
  )
}
