import { create } from 'zustand'

/**
 * Store for the hidden debug Console.
 *
 * Visibility is toggled by a triple-tap on the app logo. The logo lives in
 * the bottom navigation so it's always thumb-reachable on phones and never
 * hidden behind the iOS notch. The triple-tap logic lives in `useTripleTap`.
 *
 * `everOpened` is a persistent flag (localStorage): once the user discovers
 * the console for the first time, advanced surfaces such as the room
 * `SettingsPanel` reveal themselves. We hide those surfaces by default to
 * keep the room screen clean for casual gamers, but unlock them permanently
 * for anyone who has gone hunting in the console.
 */
const STORAGE_KEY = 'fc26:debug-console:ever-opened'

interface DebugConsoleState {
  open: boolean
  /** True once the console has been opened at least once on this device. */
  everOpened: boolean
  toggle: () => void
  close: () => void
}

function readEverOpened(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // Private mode / disabled storage — fail closed (settings stay hidden).
    return false
  }
}

function writeEverOpened(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // Best-effort: if storage is unavailable, the unlock is session-only.
  }
}

export const useDebugConsole = create<DebugConsoleState>((set) => ({
  open: false,
  everOpened: readEverOpened(),
  toggle: () =>
    set((s) => {
      const nextOpen = !s.open
      // Only mark "ever opened" on the open transition — closing must not
      // flip the flag back, and re-opens are no-ops for persistence.
      if (nextOpen && !s.everOpened) {
        writeEverOpened()
        return { open: true, everOpened: true }
      }
      return { open: nextOpen }
    }),
  close: () => set({ open: false }),
}))

/** Test hook: wipe the persisted unlock so unit tests start from a clean slate. */
export function __resetDebugConsoleForTests(): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore — same fail-safe as readEverOpened.
    }
  }
  useDebugConsole.setState({ open: false, everOpened: false })
}
