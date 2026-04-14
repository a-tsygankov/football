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
  it('resolves github release json config from env', () => {
    expect(
      resolveSquadSyncConfig({
        ...baseEnv,
        SQUAD_SYNC_SOURCE_KIND: 'github-release-json',
        SQUAD_SYNC_GITHUB_REPOSITORY: 'example/fc26-snapshots',
        SQUAD_SYNC_GITHUB_ASSET_NAME: 'fc26-latest.json',
        SQUAD_SYNC_GITHUB_TOKEN: 'secret-token',
        SQUAD_SYNC_RETENTION_COUNT: '6',
      }),
    ).toEqual({
      sourceKind: 'github-release-json',
      repository: 'example/fc26-snapshots',
      assetName: 'fc26-latest.json',
      token: 'secret-token',
      retentionCount: 6,
    })
  })

  it('infers github release json config when repository is present', () => {
    expect(
      resolveSquadSyncConfig({
        ...baseEnv,
        SQUAD_SYNC_GITHUB_REPOSITORY: 'example/fc26-snapshots',
        SQUAD_SYNC_GITHUB_ASSET_NAME: 'fc26-latest.json',
      }),
    ).toEqual({
      sourceKind: 'github-release-json',
      repository: 'example/fc26-snapshots',
      assetName: 'fc26-latest.json',
      token: null,
      retentionCount: 12,
    })
  })
})
