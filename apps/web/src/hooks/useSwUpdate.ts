import { useSyncExternalStore } from 'react'
import { swUpdateStore, type SwUpdateState } from '../lib/swUpdate.js'

/**
 * Subscribes the UI to the waiting-service-worker state owned by
 * `swUpdateStore`. Registration itself happens once at boot in `main.tsx`,
 * so this hook only ever reads.
 */
export function useSwUpdate(): SwUpdateState {
  return useSyncExternalStore(
    swUpdateStore.subscribe,
    swUpdateStore.getState,
    swUpdateStore.getState,
  )
}
