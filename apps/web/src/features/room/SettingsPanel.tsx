import {
  type RoomBootstrapResponse,
  type SquadPlatform,
  SQUAD_PLATFORMS,
} from '@fc26/shared'
import { Field } from '../../components/Field.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { Panel } from '../../components/Panel.jsx'
import {
  inputStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'

export function SettingsPanel({
  bootstrap,
  busy,
  latestSquadVersion,
  roomSquadPlatform,
  onChangeRoomSquadPlatform,
  onRefreshSquadAssets,
  onResetSquadData,
  onRetrieveSquadData,
  onSaveRoomSettings,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  latestSquadVersion: string | null
  roomSquadPlatform: SquadPlatform
  onChangeRoomSquadPlatform: (value: SquadPlatform) => void
  onRefreshSquadAssets: () => Promise<void>
  onResetSquadData: () => Promise<void>
  onRetrieveSquadData: () => Promise<void>
  onSaveRoomSettings: () => Promise<void>
}) {
  return (
    <section style={{ marginTop: 18 }}>
      <Panel
        title="Settings"
        subtitle="Manual maintenance only. Squad logo refresh stays off the daily squad stat sync."
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div
            style={{
              padding: 14,
              borderRadius: 18,
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
            }}
          >
            <strong style={{ display: 'block', fontSize: 16 }}>Squad source maintenance</strong>
            <p style={{ margin: '8px 0 0', fontSize: 14, opacity: 0.76 }}>
              Latest stored squad version: {latestSquadVersion ?? 'unseeded'}.
              Pull clubs and players manually, refresh static logos only from here, or wipe stored
              squad data completely. The room platform controls which upstream roster is used for
              EA-based retrieval.
            </p>
          </div>
          <div
            style={{
              padding: 14,
              borderRadius: 18,
              background: '#ffffff',
              border: '1px solid #d1fae5',
              display: 'grid',
              gap: 12,
            }}
          >
            <strong style={{ display: 'block', fontSize: 16 }}>Room squad platform</strong>
            <Field label="Preferred platform">
              <select
                value={roomSquadPlatform}
                onChange={(event) => onChangeRoomSquadPlatform(event.target.value as SquadPlatform)}
                disabled={busy !== null}
                style={inputStyle}
              >
                {Object.values(SQUAD_PLATFORMS).map((platform) => (
                  <option key={platform.id} value={platform.id}>
                    {platform.label}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              disabled={busy !== null || roomSquadPlatform === bootstrap.room.squadPlatform}
              onClick={() => void onSaveRoomSettings()}
              style={secondaryButtonStyle}
            >
              {busy === 'saving-room-settings' ? 'Saving platform...' : 'Save platform'}
            </button>
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onRetrieveSquadData()}
            style={primaryButtonStyle}
          >
            {busy === 'retrieving-squad-data'
              ? 'Retrieving clubs and players...'
              : 'Retrieve club and player data'}
          </button>
          <button
            type="button"
            disabled={busy !== null || !latestSquadVersion}
            onClick={() => void onRefreshSquadAssets()}
            style={secondaryButtonStyle}
          >
            {busy === 'refreshing-squad-assets'
              ? 'Refreshing logos...'
              : 'Refresh squad logos'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onResetSquadData()}
            style={{
              ...secondaryButtonStyle,
              background: '#fef2f2',
              borderColor: '#fecaca',
              color: '#991b1b',
            }}
          >
            {busy === 'resetting-squad-data' ? 'Resetting squad data...' : 'Full reset squad data'}
          </button>
          {!latestSquadVersion ? (
            <InlineNotice
              tone="warn"
              message="Retrieve squad clubs and players first, then refresh club and league logos from here."
            />
          ) : null}
        </div>
      </Panel>
    </section>
  )
}
