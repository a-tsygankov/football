/**
 * Glue between the generated service worker and the UI.
 *
 * `vite-plugin-pwa` is configured with `registerType: 'prompt'`, so a new
 * build downloads in the background and then *waits*: it never takes over
 * the page on its own. That is deliberate — a game night is a long-lived
 * tab, and swapping the bundle under someone mid-bet would be worse than
 * running a build that is a few minutes old. The waiting worker is
 * surfaced as a banner instead, and only activates when the gamer taps it.
 *
 * The store is a plain observable rather than a hook so registration can
 * happen once at boot (see `main.tsx`) while React subscribes separately.
 * `createSwUpdateStore` is exported so tests build their own instance —
 * no reset hatch on the shared one.
 */

/** Returned by `registerSW`; `reloadPage` activates the waiting worker. */
export type UpdateSW = (reloadPage?: boolean) => Promise<void>

export interface RegisterSWOptions {
  onNeedRefresh?: () => void
  onOfflineReady?: () => void
  onRegisterError?: (error: unknown) => void
}

/** The shape of `registerSW` from `virtual:pwa-register`. */
export type RegisterSW = (options: RegisterSWOptions) => UpdateSW

export interface SwUpdateState {
  /** A newer build is downloaded and waiting for the gamer's go-ahead. */
  readonly updateReady: boolean
  /** The shell is precached, so the app now works without network. */
  readonly offlineReady: boolean
}

export interface SwUpdateStore {
  subscribe(listener: () => void): () => void
  getState(): SwUpdateState
  /** Wire up the service worker. Repeat calls are ignored. */
  register(registerSW: RegisterSW): void
  /** Activate the waiting worker and reload onto the new build. */
  apply(): void
  /** Hide the prompt for this session, leaving the worker waiting. */
  dismiss(): void
}

const IDLE: SwUpdateState = Object.freeze({ updateReady: false, offlineReady: false })

export function createSwUpdateStore(): SwUpdateStore {
  let state: SwUpdateState = IDLE
  let updateSW: UpdateSW | null = null
  let registered = false
  const listeners = new Set<() => void>()

  function setState(next: SwUpdateState): void {
    if (next.updateReady === state.updateReady && next.offlineReady === state.offlineReady) {
      return
    }
    state = Object.freeze(next)
    for (const listener of listeners) listener()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    getState() {
      return state
    },

    register(registerSW) {
      // React 18 StrictMode invokes effects twice in development, and a
      // second registration would leak a duplicate workbox-window listener.
      if (registered) return
      registered = true
      updateSW = registerSW({
        onNeedRefresh: () => setState({ ...state, updateReady: true }),
        onOfflineReady: () => setState({ ...state, offlineReady: true }),
      })
    },

    apply() {
      // `true` tells workbox-window to skip waiting and reload the page.
      void updateSW?.(true)
    },

    dismiss() {
      setState({ ...state, updateReady: false })
    },
  }
}

/** The store the running app uses. Tests should build their own. */
export const swUpdateStore = createSwUpdateStore()
