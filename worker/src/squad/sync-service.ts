import { TextEncoder } from 'node:util'
import { diffSquads, type ILogger, type SquadSnapshot, type SquadSyncResult } from '@fc26/shared'
import type { ISquadStorage } from './storage.js'
import type { ISquadVersionRepository } from './version-repository.js'
import type { SquadSyncConfig } from './sync-config.js'
import { buildSquadSnapshotSource } from './sync-source.js'

const encoder = new TextEncoder()

export interface SquadSyncServiceOptions {
  readonly config: SquadSyncConfig | null
  readonly fetchImpl: typeof fetch
  readonly logger: ILogger
  readonly now: () => number
  readonly squadStorage: ISquadStorage
  readonly squadVersions: ISquadVersionRepository
}

export class SquadSyncService {
  constructor(private readonly options: SquadSyncServiceOptions) {}

  async syncLatest(): Promise<SquadSyncResult> {
    const { config, logger } = this.options
    if (!config) {
      logger.warn('squad-sync', 'sync skipped because source config is missing')
      return {
        status: 'disabled',
        version: null,
        sourceKind: null,
        sourceUrl: null,
        releasedAt: null,
        previousVersion: null,
        clubCount: 0,
        playerCount: 0,
        retainedVersions: 0,
      }
    }

    const source = buildSquadSnapshotSource(config, this.options.fetchImpl)
    const latestBefore = await this.options.squadVersions.latest()
    const snapshot = await source.getLatestSnapshot()
    logger.info('squad-sync', 'snapshot fetched', {
      version: snapshot.version,
      sourceKind: config.sourceKind,
      clubCount: snapshot.clubs.length,
      playerCount: snapshot.players.length,
    })

    const existing = await this.options.squadVersions.get(snapshot.version)
    if (existing) {
      logger.info('squad-sync', 'version already ingested', {
        version: snapshot.version,
      })
      return {
        status: 'noop',
        version: snapshot.version,
        sourceKind: config.sourceKind,
        sourceUrl: snapshot.sourceUrl,
        releasedAt: snapshot.releasedAt,
        previousVersion: latestBefore?.version ?? null,
        clubCount: existing.clubCount,
        playerCount: existing.playerCount,
        retainedVersions: (await this.options.squadVersions.list()).length,
      }
    }

    await this.writeSnapshot(snapshot, latestBefore?.version ?? null)
    await this.pruneRetention(config.retentionCount)
    const retainedVersions = (await this.options.squadVersions.list()).length

    return {
      status: 'ingested',
      version: snapshot.version,
      sourceKind: config.sourceKind,
      sourceUrl: snapshot.sourceUrl,
      releasedAt: snapshot.releasedAt,
      previousVersion: latestBefore?.version ?? null,
      clubCount: snapshot.clubs.length,
      playerCount: snapshot.players.length,
      retainedVersions,
    }
  }

  private async writeSnapshot(
    snapshot: SquadSnapshot,
    previousVersion: string | null,
  ): Promise<void> {
    const { logger, now, squadStorage, squadVersions } = this.options
    const ingestedAt = now()
    const playersByClub = groupPlayersByClub(snapshot.players)
    const versionRecord = {
      version: snapshot.version,
      releasedAt: snapshot.releasedAt,
      ingestedAt,
      clubsBytes: encoder.encode(JSON.stringify(snapshot.clubs)).length,
      clubCount: snapshot.clubs.length,
      playerCount: snapshot.players.length,
      sourceUrl: snapshot.sourceUrl,
      notes: snapshot.notes,
    } as const

    await squadStorage.putClubs(snapshot.version, snapshot.clubs)
    for (const club of snapshot.clubs) {
      await squadStorage.putPlayersForClub(
        snapshot.version,
        club.id,
        playersByClub.get(club.id) ?? [],
      )
    }

    if (previousVersion) {
      const previousSnapshot = await this.loadSnapshot(previousVersion)
      const diff = diffSquads({
        fromVersion: previousVersion,
        toVersion: snapshot.version,
        fromClubs: previousSnapshot.clubs,
        toClubs: snapshot.clubs,
        fromPlayers: previousSnapshot.players,
        toPlayers: snapshot.players,
        generatedAt: now(),
      })
      await squadStorage.putDiff(diff)
      logger.info('squad-sync', 'diff generated', {
        fromVersion: previousVersion,
        toVersion: snapshot.version,
        playerChanges: diff.playerChanges.length,
        clubChanges: diff.clubChanges.length,
        addedPlayers: diff.addedPlayers.length,
        removedPlayers: diff.removedPlayers.length,
      })
    }

    await squadStorage.putVersionMetadata(versionRecord)
    await squadStorage.setLatestVersion(snapshot.version)
    await squadVersions.insert(versionRecord)

    logger.info('squad-sync', 'snapshot stored', {
      version: snapshot.version,
      previousVersion,
      clubCount: snapshot.clubs.length,
      playerCount: snapshot.players.length,
    })
  }

  private async loadSnapshot(version: string): Promise<SquadSnapshot> {
    const clubs = await this.options.squadStorage.getClubs(version)
    if (!clubs) {
      throw new Error(`stored squad version ${version} is missing clubs.json`)
    }
    const players = (
      await Promise.all(
        clubs.map(async (club) => {
          const clubPlayers = await this.options.squadStorage.getPlayersForClub(version, club.id)
          if (!clubPlayers) {
            throw new Error(
              `stored squad version ${version} is missing players shard for club ${club.id}`,
            )
          }
          return clubPlayers
        }),
      )
    ).flat()
    const versionRow = await this.options.squadVersions.get(version)
    return {
      version,
      releasedAt: versionRow?.releasedAt ?? null,
      sourceUrl: versionRow?.sourceUrl ?? '',
      notes: versionRow?.notes ?? null,
      clubs,
      players,
    }
  }

  private async pruneRetention(retentionCount: number): Promise<void> {
    const { logger, squadStorage, squadVersions } = this.options
    const obsolete = await squadVersions.oldestVersionsBeyond(retentionCount)
    for (const version of obsolete) {
      await squadStorage.deleteVersion(version.version)
      await squadVersions.delete(version.version)
      logger.info('squad-sync', 'obsolete version pruned', {
        version: version.version,
      })
    }
  }
}

function groupPlayersByClub(
  players: ReadonlyArray<SquadSnapshot['players'][number]>,
): ReadonlyMap<number, ReadonlyArray<SquadSnapshot['players'][number]>> {
  const grouped = new Map<number, SquadSnapshot['players'][number][]>()
  for (const player of players) {
    const bucket = grouped.get(player.clubId)
    if (bucket) {
      bucket.push(player)
    } else {
      grouped.set(player.clubId, [player])
    }
  }
  return grouped
}
