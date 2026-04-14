import {
  buildEaContentUrl,
  decodeEaRosterText,
  extractRosterUpdatePlatformMetadata,
  unpackEaRosterBinary,
  type EaSquadPreviewClub,
  type EaSquadPreviewResponse,
  type SquadPlatform,
} from '@fc26/shared'
import {
  EA_SQUAD_TOOL_CONFIG,
  PREMIER_LEAGUE_NAME_ALIASES,
  PREMIER_LEAGUE_TEAM_QUERIES,
} from './config.js'

interface SportsDbTeam {
  readonly idTeam: string
  readonly strTeam: string
  readonly strTeamShort: string | null
  readonly strLeague: string
  readonly strCountry: string | null
  readonly strBadge: string | null
  readonly strAlternate: string | null
}

interface SportsDbResponse {
  readonly teams?: ReadonlyArray<SportsDbTeam> | null
}

export async function fetchPremierLeaguePreview(
  fetchImpl: typeof fetch,
  platform: SquadPlatform = EA_SQUAD_TOOL_CONFIG.defaultPlatform,
): Promise<EaSquadPreviewResponse> {
  const discoveryResponse = await fetchImpl(EA_SQUAD_TOOL_CONFIG.discoveryUrl)
  if (!discoveryResponse.ok) {
    throw new Error(`roster discovery fetch failed with status ${discoveryResponse.status}`)
  }
  const rosterXml = await discoveryResponse.text()
  const metadata = extractRosterUpdatePlatformMetadata(rosterXml, platform)
  if (!metadata.squadLocation) {
    throw new Error(`platform ${platform} does not expose a squad binary location`)
  }

  const squadUrl = buildEaContentUrl(EA_SQUAD_TOOL_CONFIG.discoveryUrl, metadata.squadLocation)
  const squadResponse = await fetchImpl(squadUrl)
  if (!squadResponse.ok) {
    throw new Error(`live EA squad fetch failed with status ${squadResponse.status}`)
  }
  const rawBytes = new Uint8Array(await squadResponse.arrayBuffer())
  const unpackedBytes = unpackEaRosterBinary(rawBytes)
  const rosterText = decodeEaRosterText(unpackedBytes)

  const sourceTeams = dedupeTeams(
    (
    await Promise.all(
      PREMIER_LEAGUE_TEAM_QUERIES.map((teamQuery) =>
        fetchSportsDbTeam(fetchImpl, teamQuery.query),
      ),
    )
    ).flat(),
  )
  if (sourceTeams.length === 0) {
    throw new Error(`no teams returned for ${EA_SQUAD_TOOL_CONFIG.leagueName}`)
  }

  const rosterSearchText = normalizeSearchText(rosterText)
  const clubs = sourceTeams
    .map((team) => buildPreviewClub(team, rosterSearchText))
    .sort((left, right) => left.name.localeCompare(right.name))

  return {
    platform,
    leagueName: EA_SQUAD_TOOL_CONFIG.leagueName,
    squadVersion: metadata.squadVersion,
    discoveryUrl: EA_SQUAD_TOOL_CONFIG.discoveryUrl,
    squadUrl,
    fetchedAt: Date.now(),
    rawBytes: rawBytes.byteLength,
    unpackedBytes: unpackedBytes.byteLength,
    matchedClubCount: clubs.filter((club) => club.foundInSquad).length,
    missingClubNames: clubs.filter((club) => !club.foundInSquad).map((club) => club.name),
    clubs,
  }
}

async function fetchSportsDbTeam(
  fetchImpl: typeof fetch,
  query: string,
): Promise<ReadonlyArray<SportsDbTeam>> {
  const sportsDbUrl = new URL('/api/v1/json/123/searchteams.php', EA_SQUAD_TOOL_CONFIG.sportsDbBaseUrl)
  sportsDbUrl.searchParams.set('t', query)
  const sportsDbResponse = await fetchImpl(sportsDbUrl)
  if (!sportsDbResponse.ok) {
    throw new Error(`club logo lookup for ${query} failed with status ${sportsDbResponse.status}`)
  }
  const sportsDbPayload = (await sportsDbResponse.json()) as SportsDbResponse
  return (sportsDbPayload.teams ?? []).filter(
    (team) => team.strLeague === EA_SQUAD_TOOL_CONFIG.leagueName,
  )
}

function buildPreviewClub(team: SportsDbTeam, rosterSearchText: string): EaSquadPreviewClub {
  const aliases = collectTeamAliases(team)
  const matchTerm = aliases.find((alias) => rosterSearchText.includes(normalizeSearchText(alias))) ?? null

  return {
    id: Number.parseInt(team.idTeam, 10),
    name: team.strTeam,
    shortName: team.strTeamShort?.trim() || team.strTeam,
    leagueName: team.strLeague,
    logoUrl: team.strBadge?.trim() || '',
    avatarUrl: null,
    country: team.strCountry?.trim() || null,
    foundInSquad: matchTerm !== null,
    matchTerm,
  }
}

function collectTeamAliases(team: SportsDbTeam): ReadonlyArray<string> {
  const alternates = splitAlternates(team.strAlternate)
  const configuredAliases = PREMIER_LEAGUE_NAME_ALIASES[team.strTeam] ?? []
  return [...new Set([team.strTeam, team.strTeamShort, ...alternates, ...configuredAliases].filter(isNonEmptyString))]
}

function splitAlternates(rawAlternates: string | null): ReadonlyArray<string> {
  if (!rawAlternates) return []
  return rawAlternates
    .split(/[,;|]/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function dedupeTeams(teams: ReadonlyArray<SportsDbTeam>): ReadonlyArray<SportsDbTeam> {
  const unique = new Map<string, SportsDbTeam>()
  for (const team of teams) {
    unique.set(team.idTeam, team)
  }
  return [...unique.values()]
}
