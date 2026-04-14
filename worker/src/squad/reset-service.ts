import type { ILogger, SquadResetResult } from '@fc26/shared'
import type { ISquadStorage } from './storage.js'
import type { ISquadVersionRepository } from './version-repository.js'

export interface SquadResetServiceOptions {
  readonly logger: ILogger
  readonly squadStorage: ISquadStorage
  readonly squadVersions: ISquadVersionRepository
}

export class SquadResetService {
  constructor(private readonly options: SquadResetServiceOptions) {}

  async resetAll(): Promise<SquadResetResult> {
    const versions = await this.options.squadVersions.list()
    if (versions.length === 0) {
      await this.options.squadStorage.clearLatestVersion()
      return {
        status: 'noop',
        deletedVersionCount: 0,
      }
    }

    for (const version of versions) {
      await this.options.squadStorage.deleteVersion(version.version)
      await this.options.squadVersions.delete(version.version)
      this.options.logger.info('squad-sync', 'deleted squad version during full reset', {
        version: version.version,
      })
    }
    await this.options.squadStorage.clearLatestVersion()

    const result: SquadResetResult = {
      status: 'reset',
      deletedVersionCount: versions.length,
    }
    this.options.logger.info('squad-sync', 'full squad reset finished', result)
    return result
  }
}
