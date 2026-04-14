import { useEffect, useState } from 'react'
import type { LogEntry } from '@fc26/shared/logger'
import { formatLocal } from '@fc26/shared/time'
import { logger } from '../lib/logger.js'
import { APP_VERSION, BUILT_AT, GIT_SHA } from '../lib/version.js'
import { useDebugConsole } from './console-store.js'

/**
 * Hidden debug Console. Triggered by a triple-tap on the app logo in the
 * bottom nav. Slides up from the bottom and shows live log entries from both
 * the client and the Worker (merged via the x-fc26-logs response header).
 *
 * This is the Phase 0 minimum: live tab and a system tab. Filter and search
 * tabs come in Phase 2 alongside CRUD routes that generate more interesting
 * traffic.
 */
type Tab = 'live' | 'system'

export function DebugConsole() {
  const open = useDebugConsole((s) => s.open)
  const close = useDebugConsole((s) => s.close)
  const [entries, setEntries] = useState<ReadonlyArray<LogEntry>>(() => logger.snapshot())
  const [tab, setTab] = useState<Tab>('live')

  useEffect(() => logger.subscribe(setEntries), [])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-label="Debug console"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: '60dvh',
        background: '#0f172a',
        color: '#e2e8f0',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        borderTop: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1000,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <strong style={{ flex: 1 }}>Console</strong>
        <TabButton active={tab === 'live'} onClick={() => setTab('live')}>
          Live
        </TabButton>
        <TabButton active={tab === 'system'} onClick={() => setTab('system')}>
          System
        </TabButton>
        <button
          type="button"
          onClick={close}
          aria-label="Close console"
          style={{ ...buttonStyle, marginLeft: 8 }}
        >
          ×
        </button>
      </header>

      <div style={{ flex: 1, overflow: 'auto', padding: '4px 12px' }}>
        {tab === 'live' ? <LiveTab entries={entries} /> : <SystemTab />}
      </div>
    </div>
  )
}

function LiveTab({ entries }: { entries: ReadonlyArray<LogEntry> }) {
  if (entries.length === 0) {
    return <p style={{ opacity: 0.5 }}>No log entries yet.</p>
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {entries.map((e) => (
        <li key={e.id} style={{ padding: '2px 0' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ opacity: 0.6, minWidth: 64 }}>{formatLocal(Date.parse(e.ts), {
              hour: '2-digit', minute: '2-digit', second: '2-digit',
            })}</span>
            <LevelBadge level={e.level} />
            <span style={{ opacity: 0.7, minWidth: 64 }}>{e.source}</span>
            <span style={{ opacity: 0.7, minWidth: 72 }}>[{e.category}]</span>
            <span style={{ flex: 1 }}>{e.message}</span>
          </div>
          {(e.level === 'warn' || e.level === 'error') && e.context && Object.keys(e.context).length > 0 ? (
            <pre
              style={{
                margin: '2px 0 4px 64px',
                padding: '6px 8px',
                background: '#1e293b',
                borderRadius: 4,
                color: '#fca5a5',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: 11,
              }}
            >
              {JSON.stringify(e.context, null, 2)}
            </pre>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function SystemTab() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  return (
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px' }}>
      <dt>App version</dt><dd>{APP_VERSION}</dd>
      <dt>Git SHA</dt><dd>{GIT_SHA}</dd>
      <dt>Built at</dt><dd>{BUILT_AT}</dd>
      <dt>Time zone</dt><dd>{tz}</dd>
      <dt>User agent</dt><dd style={{ wordBreak: 'break-all' }}>{navigator.userAgent}</dd>
    </dl>
  )
}

function LevelBadge({ level }: { level: LogEntry['level'] }) {
  const colors: Record<LogEntry['level'], string> = {
    debug: '#94a3b8',
    info: '#38bdf8',
    warn: '#fbbf24',
    error: '#f87171',
  }
  return (
    <span
      style={{
        color: colors[level],
        fontWeight: 600,
        minWidth: 44,
        textTransform: 'uppercase',
      }}
    >
      {level}
    </span>
  )
}

const buttonStyle = {
  background: 'transparent',
  border: '1px solid #334155',
  color: '#e2e8f0',
  padding: '4px 10px',
  borderRadius: 4,
  cursor: 'pointer',
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...buttonStyle,
        marginLeft: 4,
        background: active ? '#1e293b' : 'transparent',
      }}
    >
      {children}
    </button>
  )
}
