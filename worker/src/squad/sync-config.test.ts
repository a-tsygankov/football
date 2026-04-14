import { describe, expect, it } from 'vitest'
import type { Env } from '../env.js'
import { resolveSquadSyncConfig } from './sync-config.js'

const baseEnv: Env = {
  WORKER_VERSION: '0.1.0-test',
  SCHEMA_VERSION: '1',
  MIN_CLIENT_VERSION: '0.1.0',
  SESSION_SECRET: 'test-session-secret',
}

describe('resolveSquadSyncConfig', () => {
  it('resolves direct snapshot config from env', () => {
    expect(
      resolveSquadSyncConfig({
        ...baseEnv,
        SQUAD_SYNC_SOURCE_KIND: 'json-snapshot',
        SQUAD_SYNC_SOURCE_URL: 'https://snapshots.example/latest.json',
        SQUAD_SYNC_RETENTION_COUNT: '6',
      }),
    ).toEqual({
      sourceKind: 'json-snapshot',
      sourceUrl: 'https://snapshots.example/latest.json',
      retentionCount: 6,
    })
  })

  it('resolves EA discovery config and defaults the platform to PS5', () => {
    expect(
      resolveSquadSyncConfig({
        ...baseEnv,
        SQUAD_SYNC_SOURCE_KIND: 'ea-rosterupdate-json',
        SQUAD_SYNC_SNAPSHOT_URL_TEMPLATE: 'https://snapshots.example/{platform}/{version}.json',
      }),
    ).toEqual({
      sourceKind: 'ea-rosterupdate-json',
      discoveryUrl:
        'https://eafc26.content.easports.com/fc/fltOnlineAssets/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fc/fclive/genxtitle/rosterupdate.xml',
      snapshotUrlTemplate: 'https://snapshots.example/{platform}/{version}.json',
      platform: 'PS5',
      retentionCount: 12,
    })
  })
})
