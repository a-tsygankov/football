import type {
  Club,
  ClubChangeField,
  ClubFieldChange,
  FcPlayer,
  FcPlayerAttributeKey,
  FcPlayerChangeField,
  FcPlayerDiffEntry,
  FcPlayerFieldChange,
  FcPlayerRosterEntry,
  SquadDiff,
} from '../types/squad.js'

/** All player numeric fields tracked by the diff, in display order. */
const PLAYER_FIELDS: ReadonlyArray<FcPlayerChangeField> = [
  'overall',
  'pace',
  'shooting',
  'passing',
  'dribbling',
  'defending',
  'physical',
]

/** All club numeric fields tracked by the diff, in display order. */
const CLUB_FIELDS: ReadonlyArray<ClubChangeField> = [
  'overallRating',
  'attackRating',
  'midfieldRating',
  'defenseRating',
  'starRating',
]

const ATTRIBUTE_KEYS: ReadonlyArray<FcPlayerAttributeKey> = [
  'pace',
  'shooting',
  'passing',
  'dribbling',
  'defending',
  'physical',
]

export interface DiffSquadsInput {
  readonly fromVersion: string
  readonly toVersion: string
  readonly fromClubs: ReadonlyArray<Club>
  readonly toClubs: ReadonlyArray<Club>
  readonly fromPlayers: ReadonlyArray<FcPlayer>
  readonly toPlayers: ReadonlyArray<FcPlayer>
  /** UTC millis. Injected so callers can pass a fixed clock in tests. */
  readonly generatedAt: number
}

/**
 * Compute the field-level delta between two squad snapshots.
 *
 * Pure and deterministic — output is sorted so that two runs over the same
 * inputs always produce byte-identical JSON. This matters because the diff is
 * stored in R2 and served to clients; cache-friendly stable ordering avoids
 * spurious cache misses on re-ingest.
 *
 * Throws on duplicate IDs in either snapshot. The squad-sync pipeline should
 * normalise upstream data before calling this; we treat duplicates as a bug
 * that must surface loudly rather than be silently merged.
 */
export function diffSquads(input: DiffSquadsInput): SquadDiff {
  const fromClubMap = indexById(input.fromClubs, 'club')
  const toClubMap = indexById(input.toClubs, 'club')
  const fromPlayerMap = indexById(input.fromPlayers, 'player')
  const toPlayerMap = indexById(input.toPlayers, 'player')

  return {
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    generatedAt: input.generatedAt,
    playerChanges: computePlayerChanges(fromPlayerMap, toPlayerMap),
    clubChanges: computeClubChanges(fromClubMap, toClubMap),
    addedPlayers: computeRoster(fromPlayerMap, toPlayerMap, 'added'),
    removedPlayers: computeRoster(fromPlayerMap, toPlayerMap, 'removed'),
  }
}

function indexById<T extends { readonly id: number }>(
  rows: ReadonlyArray<T>,
  kind: 'club' | 'player',
): ReadonlyMap<number, T> {
  const map = new Map<number, T>()
  for (const row of rows) {
    if (map.has(row.id)) {
      throw new Error(`duplicate ${kind} id ${row.id}`)
    }
    map.set(row.id, row)
  }
  return map
}

function computePlayerChanges(
  fromMap: ReadonlyMap<number, FcPlayer>,
  toMap: ReadonlyMap<number, FcPlayer>,
): ReadonlyArray<FcPlayerDiffEntry> {
  const entries: FcPlayerDiffEntry[] = []
  for (const [id, toPlayer] of toMap) {
    const fromPlayer = fromMap.get(id)
    if (!fromPlayer) continue
    const changes = playerFieldDiff(fromPlayer, toPlayer)
    if (changes.length === 0) continue
    entries.push({
      playerId: id,
      clubId: toPlayer.clubId,
      name: toPlayer.name,
      changes,
    })
  }
  entries.sort((a, b) => a.playerId - b.playerId)
  return entries
}

function playerFieldDiff(
  from: FcPlayer,
  to: FcPlayer,
): ReadonlyArray<FcPlayerFieldChange> {
  const changes: FcPlayerFieldChange[] = []
  for (const field of PLAYER_FIELDS) {
    const fromValue = readPlayerField(from, field)
    const toValue = readPlayerField(to, field)
    if (fromValue !== toValue) {
      changes.push({ field, from: fromValue, to: toValue })
    }
  }
  return changes
}

function readPlayerField(player: FcPlayer, field: FcPlayerChangeField): number {
  if (field === 'overall') return player.overall
  // Narrowed: field is an attribute key.
  return player.attributes[field as FcPlayerAttributeKey]
}

function computeClubChanges(
  fromMap: ReadonlyMap<number, Club>,
  toMap: ReadonlyMap<number, Club>,
): ReadonlyArray<ClubFieldChange> {
  const changes: ClubFieldChange[] = []
  for (const [id, toClub] of toMap) {
    const fromClub = fromMap.get(id)
    if (!fromClub) continue
    for (const field of CLUB_FIELDS) {
      const fromValue = fromClub[field]
      const toValue = toClub[field]
      if (fromValue !== toValue) {
        changes.push({ clubId: id, field, from: fromValue, to: toValue })
      }
    }
  }
  changes.sort((a, b) => {
    if (a.clubId !== b.clubId) return a.clubId - b.clubId
    return CLUB_FIELDS.indexOf(a.field) - CLUB_FIELDS.indexOf(b.field)
  })
  return changes
}

function computeRoster(
  fromMap: ReadonlyMap<number, FcPlayer>,
  toMap: ReadonlyMap<number, FcPlayer>,
  mode: 'added' | 'removed',
): ReadonlyArray<FcPlayerRosterEntry> {
  const [source, other] = mode === 'added' ? [toMap, fromMap] : [fromMap, toMap]
  const entries: FcPlayerRosterEntry[] = []
  for (const [id, player] of source) {
    if (other.has(id)) continue
    entries.push({ clubId: player.clubId, playerId: id, name: player.name })
  }
  entries.sort((a, b) => a.playerId - b.playerId)
  return entries
}

export const __TEST_ONLY__ = {
  PLAYER_FIELDS,
  CLUB_FIELDS,
  ATTRIBUTE_KEYS,
}
