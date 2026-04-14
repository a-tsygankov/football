import { DEFAULT_SQUAD_PLATFORM, type SquadPlatform } from '@fc26/shared'

export const EA_SQUAD_TOOL_CONFIG = {
  host: process.env.FC26_SQUAD_TOOL_HOST?.trim() || '0.0.0.0',
  port: parseInt(process.env.FC26_SQUAD_TOOL_PORT?.trim() || '8790', 10),
  discoveryUrl:
    'https://eafc26.content.easports.com/fc/fltOnlineAssets/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fc/fclive/genxtitle/rosterupdate.xml',
  defaultPlatform: (process.env.FC26_SQUAD_TOOL_PLATFORM?.trim() ||
    DEFAULT_SQUAD_PLATFORM) as SquadPlatform,
  leagueName: 'English Premier League',
  sportsDbBaseUrl: 'https://www.thesportsdb.com/api/v1/json/123',
} as const

export const PREMIER_LEAGUE_NAME_ALIASES: Readonly<Record<string, ReadonlyArray<string>>> = {
  Bournemouth: ['AFC Bournemouth'],
  'AFC Bournemouth': ['Bournemouth'],
  'Brighton & Hove Albion': ['Brighton', 'Brighton and Hove Albion'],
  'Brighton and Hove Albion': ['Brighton', 'Brighton & Hove Albion'],
  'Manchester City': ['Man City'],
  'Manchester United': ['Man Utd', 'Man United'],
  'Nottingham Forest': ['Nottm Forest'],
  'Tottenham Hotspur': ['Tottenham', 'Spurs'],
  'Wolverhampton Wanderers': ['Wolves'],
}

export const PREMIER_LEAGUE_TEAM_QUERIES: ReadonlyArray<{
  readonly query: string
  readonly displayName?: string
}> = [
  { query: 'Arsenal' },
  { query: 'Aston Villa' },
  { query: 'Bournemouth' },
  { query: 'Brentford' },
  { query: 'Brighton and Hove Albion' },
  { query: 'Burnley' },
  { query: 'Chelsea' },
  { query: 'Crystal Palace' },
  { query: 'Everton' },
  { query: 'Fulham' },
  { query: 'Leeds United' },
  { query: 'Liverpool' },
  { query: 'Manchester City' },
  { query: 'Manchester United' },
  { query: 'Newcastle United' },
  { query: 'Nottingham Forest' },
  { query: 'Sunderland' },
  { query: 'Tottenham Hotspur' },
  { query: 'West Ham United' },
  { query: 'Wolverhampton Wanderers' },
]
