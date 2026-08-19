import '@testing-library/jest-dom/vitest'

/**
 * Web Storage, for Node versions that shadow jsdom's.
 *
 * Node 26 ships an experimental global `localStorage` which is `undefined`
 * unless the process was started with `--localstorage-file`. That global wins
 * over the implementation jsdom provides, so every test touching storage dies
 * on `Cannot read properties of undefined` — on Node alone, with no code
 * change in sight. An in-memory Storage is enough: these tests only ever want
 * somewhere for the room id and the debug-console flag to live.
 */
function memoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, String(value)),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (globalThis[name] == null) {
    const storage = memoryStorage()
    Object.defineProperty(globalThis, name, { value: storage, configurable: true })
    Object.defineProperty(window, name, { value: storage, configurable: true })
  }
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})
