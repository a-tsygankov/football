import { describe, expect, it } from 'vitest'
import { compareVersions, isClientOutdated } from './index.js'

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0)
    expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0)
    expect(compareVersions('1.1.1', '1.1.2')).toBeLessThan(0)
  })

  it('treats equal versions as equal', () => {
    expect(compareVersions('0.1.3', '0.1.3')).toBe(0)
  })

  it('compares segments numerically, not lexicographically', () => {
    // The trap: as strings, "0.1.10" sorts before "0.1.3". A project only
    // reaches this case once it has shipped enough patches to actually
    // need the version check, so it fails exactly when it matters.
    expect(compareVersions('0.1.10', '0.1.3')).toBeGreaterThan(0)
    expect(compareVersions('0.1.3', '0.1.10')).toBeLessThan(0)
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
  })

  it('tolerates a leading v and pre-release/build suffixes', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2.3-rc.1', '1.2.3')).toBe(0)
    expect(compareVersions('1.2.3+build.5', '1.2.3')).toBe(0)
  })

  it('returns null for unparsable input', () => {
    expect(compareVersions('', '1.0.0')).toBeNull()
    expect(compareVersions('1.0', '1.0.0')).toBeNull()
    expect(compareVersions('nightly', '1.0.0')).toBeNull()
    expect(compareVersions('1.0.0', 'x.y.z')).toBeNull()
  })
})

describe('isClientOutdated', () => {
  it('flags a client behind the minimum', () => {
    expect(isClientOutdated('0.1.3', '0.1.4')).toBe(true)
    expect(isClientOutdated('0.9.9', '1.0.0')).toBe(true)
  })

  it('accepts a client at or ahead of the minimum', () => {
    expect(isClientOutdated('0.1.4', '0.1.4')).toBe(false)
    expect(isClientOutdated('0.2.0', '0.1.4')).toBe(false)
    // A client ahead of the floor is normal right after a client-only
    // deploy, and must never be told it is stale.
    expect(isClientOutdated('0.1.10', '0.1.4')).toBe(false)
  })

  it('stays quiet when either version is unreadable', () => {
    // Better to say nothing than to nag someone to reload over a version
    // string we could not parse.
    expect(isClientOutdated('dev', '0.1.4')).toBe(false)
    expect(isClientOutdated('0.1.3', '')).toBe(false)
  })
})
