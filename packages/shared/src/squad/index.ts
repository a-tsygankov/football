export { diffSquads } from './diff.js'
export type { DiffSquadsInput } from './diff.js'
export {
  MAX_STAR_RATING_10,
  MIN_STAR_RATING_10,
  overallRangeForStarRating10,
  starRating10FromOverall,
} from './stars.js'
export {
  compareLeagueNames,
  getLeagueSortPriority,
  isNonCompetitiveLeagueName,
} from './league-order.js'
export { CLUB_NAME_ALIASES, canonicaliseClubName } from './club-aliases.js'
export type { ClubAlias } from './club-aliases.js'
export { canonicaliseLeagueIds } from './canonicalise-leagues.js'
export { canonicaliseClubs, remapPlayerClubIds } from './canonicalise-clubs.js'
export {
  COUNTRY_PILL_ORDER,
  EA_LEAGUE_NATIONS,
  EA_NATION_NAMES,
  getLeagueCountryName,
  getLeagueNationId,
  isRestOfWorldLeague,
  isWomensLeague,
} from './league-metadata.js'
export type { ClubCanonicalisationResult } from './canonicalise-clubs.js'
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
