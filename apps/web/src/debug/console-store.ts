import { create } from 'zustand'

/**
 * Store for the hidden debug Console.
 *
 * Visibility is toggled by a triple-tap on the app logo. The logo lives in
 * the bottom navigation so it's always thumb-reachable on phones and never
 * hidden behind the iOS notch. The triple-tap logic lives in `useTripleTap`.
 */
interface DebugConsoleState {
  open: boolean
  toggle: () => void
  close: () => void
}

export const useDebugConsole = create<DebugConsoleState>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}))
