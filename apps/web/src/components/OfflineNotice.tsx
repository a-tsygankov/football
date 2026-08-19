/**
 * Shown while the device has no network.
 *
 * Before the service worker existed, opening the installed app offline gave
 * a white screen — nothing was cached, so nothing rendered. Now the shell
 * comes out of the precache, which means we can say what is actually going
 * on: the UI is here, the room behind /api is not.
 */
export function OfflineNotice() {
  return (
    <div
      role="status"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 21,
        padding: '10px 14px',
        background: '#e2e8f0',
        borderBottom: '1px solid #94a3b8',
        color: '#1e293b',
        fontSize: 13,
        textAlign: 'center',
      }}
    >
      You are offline. Room data will reconnect on its own once you are back.
    </div>
  )
}
