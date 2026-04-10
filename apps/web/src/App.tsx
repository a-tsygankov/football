import { useEffect, useState } from 'react'
import { apiJson } from './lib/api.js'
import { logger } from './lib/logger.js'
import { APP_VERSION, type WorkerVersionInfo } from './lib/version.js'
import { BottomNav } from './components/BottomNav.jsx'
import { DebugConsole } from './debug/DebugConsole.jsx'

export function App() {
  const [worker, setWorker] = useState<WorkerVersionInfo | null>(null)
  const [workerError, setWorkerError] = useState<string | null>(null)

  useEffect(() => {
    logger.info('system', 'app booted', { appVersion: APP_VERSION })
    void apiJson<WorkerVersionInfo>('/api/version')
      .then((v) => {
        setWorker(v)
        logger.info('system', 'worker version loaded', v)
      })
      .catch((err) => {
        setWorkerError(err instanceof Error ? err.message : String(err))
        logger.warn('system', 'worker version fetch failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      })
  }, [])

  return (
    <div
      style={{
        minHeight: '100dvh',
        paddingBottom: 'calc(64px + env(safe-area-inset-bottom))',
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        background: '#f8fafc',
        color: '#0f172a',
      }}
    >
      <main style={{ padding: 20, maxWidth: 480, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, margin: '16px 0 4px' }}>FC 26 Team Picker</h1>
        <p style={{ margin: 0, opacity: 0.7 }}>Phase 0 scaffold — nothing playable yet.</p>

        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Status</h2>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
            <dt>Client version</dt>
            <dd>{APP_VERSION}</dd>
            <dt>Worker</dt>
            <dd>
              {worker
                ? `v${worker.workerVersion} (schema ${worker.schemaVersion})`
                : workerError
                  ? `unreachable — ${workerError}`
                  : 'loading…'}
            </dd>
          </dl>
        </section>

        <p style={{ marginTop: 32, fontSize: 13, opacity: 0.6 }}>
          Triple-tap the FC26 logo in the bottom nav to open the debug console.
        </p>
      </main>

      <BottomNav />
      <DebugConsole />
    </div>
  )
}
