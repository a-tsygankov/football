import type { Gamer, RoomBootstrapResponse } from '@fc26/shared'
import { GamerIdentity } from '../../components/GamerPanel.jsx'
import { Panel } from '../../components/Panel.jsx'
import { secondaryButtonStyle } from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'

export function GameNightRosterPanel({
  bootstrap,
  busy,
  activeRoomGamers,
  currentGameGamerIds,
  draftActiveGamerIds,
  hasUnsavedActiveGamers,
  onToggleDraftGamer,
  onSaveActiveGameNightGamers,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  activeRoomGamers: ReadonlyArray<Gamer>
  currentGameGamerIds: ReadonlySet<string>
  draftActiveGamerIds: ReadonlyArray<string>
  hasUnsavedActiveGamers: boolean
  onToggleDraftGamer: (gamerId: string) => void
  onSaveActiveGameNightGamers: (
    gameNightId: string,
    activeGamerIds: string[],
  ) => Promise<void>
}) {
  return (
    <Panel
      title="Game night roster"
      subtitle="Pick who is in the live pool. Locked gamers are already in the current game."
    >
      <div style={{ display: 'grid', gap: 10 }}>
        {activeRoomGamers.map((gamer) => {
          const selected = draftActiveGamerIds.includes(gamer.id)
          const locked = currentGameGamerIds.has(gamer.id)
          return (
            <button
              key={gamer.id}
              type="button"
              disabled={busy !== null || locked}
              onClick={() => onToggleDraftGamer(gamer.id)}
              style={{
                textAlign: 'left',
                borderRadius: 18,
                padding: 14,
                border: `1px solid ${selected ? '#22c55e' : '#bbf7d0'}`,
                background: selected ? '#ecfdf5' : '#ffffff',
                color: '#052e16',
                cursor: locked ? 'not-allowed' : 'pointer',
                opacity: locked ? 0.7 : 1,
              }}
            >
              <GamerIdentity
                gamer={gamer}
                size={48}
                subtitle={`Rating ${gamer.rating}${locked ? ' • locked in current game' : selected ? ' • in live pool' : ' • out'}`}
              />
            </button>
          )
        })}
      </div>
      <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 14, opacity: 0.72 }}>
          {draftActiveGamerIds.length} gamers selected for the live pool.
        </div>
        <button
          type="button"
          disabled={busy !== null || !hasUnsavedActiveGamers || draftActiveGamerIds.length < 2}
          onClick={() =>
            bootstrap.activeGameNight
              ? void onSaveActiveGameNightGamers(
                  bootstrap.activeGameNight.id,
                  [...draftActiveGamerIds],
                )
              : undefined
          }
          style={secondaryButtonStyle}
        >
          {busy === 'saving-active-gamers' ? 'Saving roster...' : 'Save live pool'}
        </button>
      </div>
    </Panel>
  )
}
