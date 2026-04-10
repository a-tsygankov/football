import { describe, expect, it } from 'vitest'
import { fixedClock, formatRelative, fromUtcMillis, toUtcMillis } from './index.js'

describe('time helpers', () => {
  it('round-trips a Date through millis', () => {
    const d = new Date('2026-04-10T12:34:56.789Z')
    expect(fromUtcMillis(toUtcMillis(d)).toISOString()).toBe(d.toISOString())
  })

  it('formatRelative respects an injected now', () => {
    const now = 1_000_000_000
    expect(formatRelative(now - 60_000, now)).toMatch(/minute/)
    expect(formatRelative(now - 86_400_000, now)).toMatch(/day|yesterday/)
  })

  it('fixedClock returns the same value every call', () => {
    const c = fixedClock(42)
    expect(c.now()).toBe(42)
    expect(c.now()).toBe(42)
  })
})
