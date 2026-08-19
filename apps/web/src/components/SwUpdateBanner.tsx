/**
 * Shown when the service worker has downloaded a newer build and is waiting
 * to take over.
 *
 * The sibling `UpdateBanner` is the hard case — this client has fallen under
 * the worker's `minClientVersion` floor and may be talking to an API it no
 * longer agrees with, so it is an `alert` with no way out but reloading.
 * This one is the soft case: the running build is still perfectly valid, the
 * new one is merely nicer. So it is a polite `status`, and "Later" leaves the
 * worker waiting — nobody gets thrown out of a bet they are halfway through.
 * Dismissing only hides it for this session; the prompt returns next launch.
 */
export function SwUpdateBanner({
  onReload,
  onDismiss,
}: {
  /** Activates the waiting worker and reloads onto the new build. */
  onReload: () => void
  onDismiss: () => void
}) {
  return (
    <div
      role="status"
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
        background: '#d1fae5',
        borderBottom: '1px solid #10b981',
        color: '#052e16',
        fontSize: 13,
      }}
    >
      <span>A new version of the app is ready.</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            border: 'none',
            background: 'transparent',
            color: '#065f46',
            padding: '6px 10px',
            fontSize: 13,
            cursor: 'pointer',
            textDecoration: 'underline',
            whiteSpace: 'nowrap',
          }}
        >
          Later
        </button>
        <button
          type="button"
          onClick={onReload}
          style={{
            border: '1px solid #047857',
            background: '#6ee7b7',
            color: '#052e16',
            borderRadius: 999,
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Reload to update
        </button>
      </span>
    </div>
  )
}
