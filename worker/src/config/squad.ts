import { DEFAULT_SQUAD_PLATFORM, type SquadPlatform } from '@fc26/shared'

export interface SquadAppConfig {
  readonly sync: {
    readonly sourceKind:
      | 'json-snapshot'
      | 'ea-rosterupdate-json'
      | 'ea-rosterupdate-binary'
    readonly sourceUrl: string
    readonly discoveryUrl: string
    /** Only used by the legacy `ea-rosterupdate-json` source kind. */
    readonly snapshotUrlTemplate: string
    readonly defaultPlatform: SquadPlatform
    readonly retentionCount: number
  }
  readonly assets: {
    readonly providerBaseUrl: string
    readonly leagueAliases: Readonly<Record<string, string>>
  }
}

export const SQUAD_APP_CONFIG: SquadAppConfig = {
  sync: {
    // Read the EA roster binary directly, the same flow the local EA preview
    // uses. No external normalised-snapshot host required.
    sourceKind: 'ea-rosterupdate-binary',
    sourceUrl: '',
    discoveryUrl:
      'https://eafc26.content.easports.com/fc/fltOnlineAssets/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fc/fclive/genxtitle/rosterupdate.xml',
    snapshotUrlTemplate: '',
    defaultPlatform: DEFAULT_SQUAD_PLATFORM,
    retentionCount: 12,
  },
  assets: {
    providerBaseUrl: 'https://www.thesportsdb.com/api/v1/json/123',
    leagueAliases: {},
  },
}
