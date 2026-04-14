export { diffSquads } from './diff.js'
export type { DiffSquadsInput } from './diff.js'
export {
  buildEaContentUrl,
  decodeEaRosterText,
  extractRosterUpdatePlatformMetadata,
  unpackEaRosterBinary,
} from './ea-raw.js'
export type { RosterUpdatePlatformMetadata } from './ea-raw.js'
export { readEaSquadTables } from './ea-db.js'
export type {
  EaLeagueRecord,
  EaLeagueTeamLinkRecord,
  EaSquadTables,
  EaTeamFormDiffRecord,
  EaTeamRecord,
} from './ea-db.js'
