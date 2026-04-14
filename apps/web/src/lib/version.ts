export const APP_VERSION = __APP_VERSION__
export const GIT_SHA = __GIT_SHA__
export const BUILT_AT = __BUILT_AT__

export interface WorkerVersionInfo {
  workerVersion: string
  schemaVersion: number
  minClientVersion: string
  gitSha: string | null
  builtAt: string
  latestSquadVersion?: string | null
}
