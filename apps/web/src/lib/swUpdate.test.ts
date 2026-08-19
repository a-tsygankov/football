import { describe, expect, it, vi } from 'vitest'
import { createSwUpdateStore, type RegisterSW } from './swUpdate.js'

/**
 * A stand-in for `virtual:pwa-register`'s `registerSW`. It captures the
 * callbacks so a test can fire the same events workbox-window would, and
 * records reload requests so we can assert we never reload on our own.
 */
function fakeRegisterSW() {
  const reloads: Array<boolean | undefined> = []
  let fire: { needRefresh?: () => void; offlineReady?: () => void } = {}
  const registerSW: RegisterSW = (options) => {
    fire = { needRefresh: options.onNeedRefresh, offlineReady: options.onOfflineReady }
    return async (reloadPage?: boolean) => {
      reloads.push(reloadPage)
    }
  }
  return {
    registerSW,
    reloads,
    needRefresh: () => fire.needRefresh?.(),
    offlineReady: () => fire.offlineReady?.(),
  }
}

describe('swUpdateStore', () => {
  it('starts with no update waiting', () => {
    const store = createSwUpdateStore()

    expect(store.getState().updateReady).toBe(false)
  })

  it('flags an update once the service worker reports one waiting', () => {
    const store = createSwUpdateStore()
    const sw = fakeRegisterSW()
    store.register(sw.registerSW)

    sw.needRefresh()

    expect(store.getState().updateReady).toBe(true)
  })

  it('notifies subscribers when an update arrives', () => {
    const store = createSwUpdateStore()
    const sw = fakeRegisterSW()
    store.register(sw.registerSW)
    const listener = vi.fn()
    store.subscribe(listener)

    sw.needRefresh()

    expect(listener).toHaveBeenCalled()
  })

  it('does not reload until the gamer asks for it', () => {
    // Reloading mid-game-night would drop someone out of an in-flight bet.
    const store = createSwUpdateStore()
    const sw = fakeRegisterSW()
    store.register(sw.registerSW)

    sw.needRefresh()

    expect(sw.reloads).toEqual([])
  })

  it('activates the waiting worker and reloads on apply()', () => {
    const store = createSwUpdateStore()
    const sw = fakeRegisterSW()
    store.register(sw.registerSW)
    sw.needRefresh()

    store.apply()

    expect(sw.reloads).toEqual([true])
  })

  it('hides the prompt when dismissed, without applying the update', () => {
    const store = createSwUpdateStore()
    const sw = fakeRegisterSW()
    store.register(sw.registerSW)
    sw.needRefresh()

    store.dismiss()

    expect(store.getState().updateReady).toBe(false)
    expect(sw.reloads).toEqual([])
  })

  it('keeps a stable snapshot identity so useSyncExternalStore does not loop', () => {
    const store = createSwUpdateStore()

    expect(store.getState()).toBe(store.getState())
  })

  it('registers the worker only once even under StrictMode double-invocation', () => {
    const store = createSwUpdateStore()
    const registerSW = vi.fn<RegisterSW>(() => async () => {})

    store.register(registerSW)
    store.register(registerSW)

    expect(registerSW).toHaveBeenCalledTimes(1)
  })
})
