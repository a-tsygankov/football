/**
 * Shown when this client build has fallen below the worker's
 * `minClientVersion`. Deliberately not dismissible: `minClientVersion` is a
 * floor, not a suggestion — a client under it may be talking to an API it
 * no longer agrees with, so the prompt stays until the app is reloaded.
 *
 * It does not block interaction, matching the documented intent on the
 * worker's /api/version route ("banner only, no hard stop").
 */
export function UpdateBanner({
  clientVersion,
  minClientVersion,
  onReload,
}: {
  clientVersion: string
  minClientVersion: string
  /** Injected so tests don't have to stub location.reload. */
  onReload: () => void
}) {
  return (
    <div
      role="alert"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        padding: '10px 14px',
        background: '#fef3c7',
        borderBottom: '1px solid #f59e0b',
        color: '#78350f',
        fontSize: 13,
      }}
    >
      <span>
        A newer version is available. You are on{' '}
        <strong>{clientVersion}</strong>; this room needs at least{' '}
        <strong>{minClientVersion}</strong>.
      </span>
      <button
        type="button"
        onClick={onReload}
        style={{
          border: '1px solid #b45309',
          background: '#fde68a',
          color: '#78350f',
          borderRadius: 999,
          padding: '6px 14px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Reload
      </button>
    </div>
  )
}
