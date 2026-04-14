import type { Club, FcPlayer, SquadDiff } from '@fc26/shared'
import { type ISquadStorage, squadKeys } from './storage.js'

/**
 * In-memory implementation used by tests and by the dev shell when no R2
 * binding is configured. Mirrors the R2 key layout one-for-one so behaviour
 * stays interchangeable: anything observable through the interface should
 * behave identically to the real R2 implementation.
 */
export class InMemorySquadStorage implements ISquadStorage {
  private readonly entries = new Map<string, unknown>()

  async getLatestVersion(): Promise<string | null> {
    const value = this.entries.get(squadKeys('').latestPointer) as
      | { version: string }
      | undefined
    return value?.version ?? null
  }

  async setLatestVersion(version: string): Promise<void> {
    this.entries.set(squadKeys('').latestPointer, { version })
  }

  async clearLatestVersion(): Promise<void> {
    this.entries.delete(squadKeys('').latestPointer)
  }

  async getClubs(version: string): Promise<ReadonlyArray<Club> | null> {
    const value = this.entries.get(squadKeys(version).clubs) as
      | ReadonlyArray<Club>
      | undefined
    return value ?? null
  }

  async putClubs(version: string, clubs: ReadonlyArray<Club>): Promise<void> {
    this.entries.set(squadKeys(version).clubs, clubs)
  }

  async getPlayersForClub(
    version: string,
    clubId: number,
  ): Promise<ReadonlyArray<FcPlayer> | null> {
    const value = this.entries.get(squadKeys(version).playersFor(clubId)) as
      | ReadonlyArray<FcPlayer>
      | undefined
    return value ?? null
  }

  async putPlayersForClub(
    version: string,
    clubId: number,
    players: ReadonlyArray<FcPlayer>,
  ): Promise<void> {
    this.entries.set(squadKeys(version).playersFor(clubId), players)
  }

  async getDiff(
    fromVersion: string,
    toVersion: string,
  ): Promise<SquadDiff | null> {
    const value = this.entries.get(squadKeys(toVersion).diffFrom(fromVersion)) as
      | SquadDiff
      | undefined
    return value ?? null
  }

  async putDiff(diff: SquadDiff): Promise<void> {
    this.entries.set(
      squadKeys(diff.toVersion).diffFrom(diff.fromVersion),
      diff,
    )
  }

  async deleteVersion(version: string): Promise<void> {
    const prefix = squadKeys(version).versionPrefix
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key)
    }
  }
}
