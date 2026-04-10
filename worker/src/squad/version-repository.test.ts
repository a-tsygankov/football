import { describe, expect, it } from 'vitest'
import type { SquadVersion } from '@fc26/shared'
import { InMemorySquadVersionRepository } from './version-repository.js'

function makeVersion(version: string, ingestedAt: number): SquadVersion {
  return {
    version,
    releasedAt: ingestedAt - 60_000,
    ingestedAt,
    clubsBytes: 500_000,
    clubCount: 700,
    playerCount: 18_000,
    sourceUrl: `https://github.com/xAranaktu/FIFASquadFileDownloader/releases/${version}`,
    notes: null,
  }
}

describe('InMemorySquadVersionRepository', () => {
  it('returns latest by ingestedAt regardless of insertion order', async () => {
    const repo = new InMemorySquadVersionRepository()
    await repo.insert(makeVersion('fc26-r10', 1_000))
    await repo.insert(makeVersion('fc26-r12', 3_000))
    await repo.insert(makeVersion('fc26-r11', 2_000))

    const latest = await repo.latest()
    expect(latest?.version).toBe('fc26-r12')
  })

  it('list() is newest-first', async () => {
    const repo = new InMemorySquadVersionRepository()
    await repo.insert(makeVersion('fc26-r10', 1_000))
    await repo.insert(makeVersion('fc26-r11', 2_000))
    await repo.insert(makeVersion('fc26-r12', 3_000))

    const all = await repo.list()
    expect(all.map((v) => v.version)).toEqual([
      'fc26-r12',
      'fc26-r11',
      'fc26-r10',
    ])
  })

  it('rejects duplicate version inserts', async () => {
    const repo = new InMemorySquadVersionRepository()
    await repo.insert(makeVersion('fc26-r10', 1_000))
    await expect(repo.insert(makeVersion('fc26-r10', 9_999))).rejects.toThrow(
      /already exists/,
    )
  })

  it('oldestVersionsBeyond returns versions to prune oldest-first', async () => {
    const repo = new InMemorySquadVersionRepository()
    for (let i = 0; i < 5; i++) {
      await repo.insert(makeVersion(`fc26-r${i + 10}`, (i + 1) * 1000))
    }
    // Keep newest 2 → drop versions r10, r11, r12
    const toPrune = await repo.oldestVersionsBeyond(2)
    expect(toPrune.map((v) => v.version)).toEqual([
      'fc26-r10',
      'fc26-r11',
      'fc26-r12',
    ])
  })

  it('oldestVersionsBeyond returns empty when count is within keep window', async () => {
    const repo = new InMemorySquadVersionRepository()
    await repo.insert(makeVersion('fc26-r10', 1000))
    expect(await repo.oldestVersionsBeyond(12)).toEqual([])
  })

  it('rejects negative keepCount', async () => {
    const repo = new InMemorySquadVersionRepository()
    await expect(repo.oldestVersionsBeyond(-1)).rejects.toThrow(/>= 0/)
  })

  it('delete removes a single version', async () => {
    const repo = new InMemorySquadVersionRepository()
    await repo.insert(makeVersion('fc26-r10', 1_000))
    await repo.insert(makeVersion('fc26-r11', 2_000))
    await repo.delete('fc26-r10')
    expect(await repo.get('fc26-r10')).toBeNull()
    expect((await repo.list()).map((v) => v.version)).toEqual(['fc26-r11'])
  })
})
