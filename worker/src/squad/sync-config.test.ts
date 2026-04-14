import { describe, expect, it } from 'vitest'
import { resolveSquadSyncConfig } from './sync-config.js'

describe('resolveSquadSyncConfig', () => {
  it('resolves EA binary discovery config and defaults the platform to PS5', () => {
    expect(resolveSquadSyncConfig()).toEqual({
      sourceKind: 'ea-rosterupdate-binary',
      discoveryUrl:
        'https://eafc26.content.easports.com/fc/fltOnlineAssets/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fc/fclive/genxtitle/rosterupdate.xml',
      platform: 'PS5',
      retentionCount: 12,
    })
  })

  it('lets a room override the configured default platform', () => {
    expect(resolveSquadSyncConfig({ platform: 'XBSX' })).toEqual({
      sourceKind: 'ea-rosterupdate-binary',
      discoveryUrl:
        'https://eafc26.content.easports.com/fc/fltOnlineAssets/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fc/fclive/genxtitle/rosterupdate.xml',
      platform: 'XBSX',
      retentionCount: 12,
    })
  })
})
