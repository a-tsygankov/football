interface EaFieldSchema {
  readonly shortName: string
  readonly name: string
  readonly type: 'int' | 'string' | 'float'
  readonly rangeLow?: number
}

interface EaTableSchema {
  readonly shortName: string
  readonly primaryKey: string
  readonly fields: ReadonlyArray<EaFieldSchema>
}

interface ParsedFieldDefinition {
  readonly shortName: string
  readonly type: number
  readonly bitOffset: number
  readonly bitDepth: number
}

interface ParsedTableHeader {
  readonly recordSize: number
  readonly validRecordsCount: number
  readonly fieldsCount: number
  readonly fields: ReadonlyArray<ParsedFieldDefinition>
  readonly dataOffset: number
}

export interface EaTeamRecord {
  readonly teamId: number
  readonly teamName: string
  readonly overallRating: number
  readonly attackRating: number
  readonly midfieldRating: number
  readonly defenseRating: number
  readonly matchdayOverallRating: number
  readonly matchdayAttackRating: number
  readonly matchdayMidfieldRating: number
  readonly matchdayDefenseRating: number
}

export interface EaLeagueRecord {
  readonly leagueId: number
  readonly leagueName: string
}

export interface EaLeagueTeamLinkRecord {
  readonly teamId: number
  readonly leagueId: number
}

export interface EaTeamFormDiffRecord {
  readonly teamId: number
  readonly oldOverallRating: number
  readonly newOverallRating: number
  readonly overallRatingDiff: number
  readonly oldAttackRating: number
  readonly newAttackRating: number
  readonly oldMidfieldRating: number
  readonly newMidfieldRating: number
  readonly oldDefenseRating: number
  readonly newDefenseRating: number
}

export interface EaSquadTables {
  readonly teams: ReadonlyArray<EaTeamRecord>
  readonly leagues: ReadonlyArray<EaLeagueRecord>
  readonly leagueTeamLinks: ReadonlyArray<EaLeagueTeamLinkRecord>
  readonly teamFormDiff: ReadonlyArray<EaTeamFormDiffRecord>
}

const DB_HEADER = Uint8Array.from([0x44, 0x42, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00])

const TEAMS_SCHEMA: EaTableSchema = {
  shortName: 'lyxL',
  primaryKey: 'teamId',
  fields: [
    { shortName: 'mCXg', name: 'teamId', type: 'int', rangeLow: 1 },
    { shortName: 'AUsv', name: 'teamName', type: 'string' },
    { shortName: 'UERs', name: 'overallRating', type: 'int' },
    { shortName: 'UAKP', name: 'attackRating', type: 'int' },
    { shortName: 'SqFN', name: 'midfieldRating', type: 'int' },
    { shortName: 'btsS', name: 'defenseRating', type: 'int' },
    { shortName: 'sqCP', name: 'matchdayOverallRating', type: 'int' },
    { shortName: 'jmRz', name: 'matchdayAttackRating', type: 'int' },
    { shortName: 'HHDP', name: 'matchdayMidfieldRating', type: 'int' },
    { shortName: 'zHfR', name: 'matchdayDefenseRating', type: 'int' },
  ],
}

const LEAGUES_SCHEMA: EaTableSchema = {
  shortName: 'onMQ',
  primaryKey: 'leagueId',
  fields: [
    { shortName: 'aQrQ', name: 'leagueId', type: 'int', rangeLow: 1 },
    { shortName: 'HEQX', name: 'leagueName', type: 'string' },
  ],
}

const LEAGUE_TEAM_LINKS_SCHEMA: EaTableSchema = {
  shortName: 'qdZF',
  primaryKey: 'teamId',
  fields: [
    { shortName: 'mCXg', name: 'teamId', type: 'int', rangeLow: 1 },
    { shortName: 'aQrQ', name: 'leagueId', type: 'int', rangeLow: 1 },
  ],
}

const TEAM_FORM_DIFF_SCHEMA: EaTableSchema = {
  shortName: 'OIcD',
  primaryKey: 'teamId',
  fields: [
    { shortName: 'mCXg', name: 'teamId', type: 'int', rangeLow: 1 },
    { shortName: 'HjSL', name: 'oldOverallRating', type: 'int' },
    { shortName: 'xKVG', name: 'newOverallRating', type: 'int' },
    { shortName: 'BssH', name: 'overallRatingDiff', type: 'int', rangeLow: -99 },
    { shortName: 'ArvO', name: 'oldAttackRating', type: 'int' },
    { shortName: 'Kjlq', name: 'newAttackRating', type: 'int' },
    { shortName: 'YxAQ', name: 'oldMidfieldRating', type: 'int' },
    { shortName: 'jjwz', name: 'newMidfieldRating', type: 'int' },
    { shortName: 'kePB', name: 'oldDefenseRating', type: 'int' },
    { shortName: 'WjAg', name: 'newDefenseRating', type: 'int' },
  ],
}

export function readEaSquadTables(input: ArrayBuffer | Uint8Array): EaSquadTables {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input)
  const reader = new ByteReader(data)

  const headerOffset = indexOfBytes(data, DB_HEADER)
  if (headerOffset < 0) {
    throw new Error('EA database header was not found in the unpacked roster payload')
  }

  reader.position = headerOffset + DB_HEADER.length
  const databaseSize = reader.readUInt32LE()
  if (headerOffset + databaseSize > data.length) {
    throw new Error('EA database size exceeds the unpacked roster payload size')
  }

  reader.skip(4)
  const tableCount = reader.readUInt32LE()
  reader.skip(4)

  const tableOffsets = new Map<string, number>()
  for (let index = 0; index < tableCount; index += 1) {
    const shortName = reader.readString(4)
    const tableOffset = reader.readUInt32LE()
    tableOffsets.set(shortName, tableOffset)
  }

  reader.skip(4)
  const tablesStartOffset = reader.position

  return {
    teams: readTable<EaTeamRecord>(data, tablesStartOffset, tableOffsets, TEAMS_SCHEMA),
    leagues: readTable<EaLeagueRecord>(data, tablesStartOffset, tableOffsets, LEAGUES_SCHEMA),
    leagueTeamLinks: readTable<EaLeagueTeamLinkRecord>(
      data,
      tablesStartOffset,
      tableOffsets,
      LEAGUE_TEAM_LINKS_SCHEMA,
    ),
    teamFormDiff: readTable<EaTeamFormDiffRecord>(
      data,
      tablesStartOffset,
      tableOffsets,
      TEAM_FORM_DIFF_SCHEMA,
    ),
  }
}

function readTable<Row extends object>(
  data: Uint8Array,
  tablesStartOffset: number,
  tableOffsets: ReadonlyMap<string, number>,
  schema: EaTableSchema,
): ReadonlyArray<Row> {
  const tableOffset = tableOffsets.get(schema.shortName)
  if (typeof tableOffset !== 'number') {
    return []
  }

  const header = readTableHeader(data, tablesStartOffset + tableOffset)
  if (header.validRecordsCount <= 0) {
    return []
  }

  const parsedFields = new Map<string, ParsedFieldDefinition>()
  for (const field of header.fields) {
    parsedFields.set(field.shortName, field)
  }

  const rows: Row[] = []
  for (let recordIndex = 0; recordIndex < header.validRecordsCount; recordIndex += 1) {
    const recordStart = header.dataOffset + recordIndex * header.recordSize
    const record: Record<string, string | number> = {}

    for (const fieldSchema of schema.fields) {
      const fieldDefinition = parsedFields.get(fieldSchema.shortName)
      if (!fieldDefinition) {
        continue
      }
      record[fieldSchema.name] = readFieldValue(data, recordStart, fieldDefinition, fieldSchema)
    }

    if (typeof record[schema.primaryKey] === 'number') {
      rows.push(record as Row)
    }
  }

  return rows
}

function readTableHeader(data: Uint8Array, tableStartOffset: number): ParsedTableHeader {
  const reader = new ByteReader(data)
  reader.position = tableStartOffset
  reader.skip(4)
  const recordSize = reader.readUInt32LE()
  reader.skip(10)
  const validRecordsCount = reader.readUInt16LE()
  reader.skip(4)
  const fieldsCount = reader.readUInt8()
  reader.skip(11)

  const fields: ParsedFieldDefinition[] = []
  for (let index = 0; index < fieldsCount; index += 1) {
    fields.push({
      type: reader.readUInt32LE(),
      bitOffset: reader.readUInt32LE(),
      shortName: reader.readString(4),
      bitDepth: reader.readUInt32LE(),
    })
  }

  fields.sort((left, right) => left.bitOffset - right.bitOffset)

  return {
    recordSize,
    validRecordsCount,
    fieldsCount,
    fields,
    dataOffset: reader.position,
  }
}

function readFieldValue(
  data: Uint8Array,
  recordStart: number,
  definition: ParsedFieldDefinition,
  schema: EaFieldSchema,
): string | number {
  if (schema.type === 'string' && definition.type === 0) {
    const byteLength = definition.bitDepth >> 3
    const start = recordStart + (definition.bitOffset >> 3)
    const end = start + byteLength
    let cursor = start
    while (cursor < end && data[cursor] !== 0) {
      cursor += 1
    }
    return new TextDecoder('utf-8').decode(data.subarray(start, cursor)).trim()
  }

  if (schema.type === 'float' && definition.type === 4) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    return view.getFloat32(recordStart + (definition.bitOffset >> 3), true)
  }

  const rawValue = readBitsLE(data, recordStart, definition.bitOffset, definition.bitDepth)
  return rawValue + (schema.rangeLow ?? 0)
}

function readBitsLE(
  data: Uint8Array,
  recordStart: number,
  bitOffset: number,
  bitDepth: number,
): number {
  let value = 0
  for (let bitIndex = 0; bitIndex < bitDepth; bitIndex += 1) {
    const absoluteBit = bitOffset + bitIndex
    const byteIndex = recordStart + (absoluteBit >> 3)
    const bitMask = 1 << (absoluteBit & 0x07)
    if ((data[byteIndex] ?? 0) & bitMask) {
      value |= 1 << bitIndex
    }
  }
  return value
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        continue outer
      }
    }
    return index
  }
  return -1
}

class ByteReader {
  position = 0

  constructor(private readonly data: Uint8Array) {}

  readUInt8(): number {
    const value = this.data[this.position]
    if (typeof value !== 'number') {
      throw new Error('Unexpected end of EA database payload')
    }
    this.position += 1
    return value
  }

  readUInt16LE(): number {
    const low = this.readUInt8()
    const high = this.readUInt8()
    return low | (high << 8)
  }

  readUInt32LE(): number {
    const b0 = this.readUInt8()
    const b1 = this.readUInt8()
    const b2 = this.readUInt8()
    const b3 = this.readUInt8()
    return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
  }

  readString(length: number): string {
    const start = this.position
    const end = start + length
    if (end > this.data.length) {
      throw new Error('Unexpected end of EA database payload while reading string')
    }
    this.position = end
    return new TextDecoder('latin1').decode(this.data.subarray(start, end))
  }

  skip(length: number): void {
    this.position += length
    if (this.position > this.data.length) {
      throw new Error('Unexpected end of EA database payload while skipping bytes')
    }
  }
}
