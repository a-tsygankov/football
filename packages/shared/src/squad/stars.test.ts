import { describe, expect, it } from 'vitest'
import {
  overallRangeForStarRating10,
  starRating10FromOverall,
} from './stars.js'

describe('starRating10FromOverall', () => {
  it('maps every band boundary to the documented half-star value', () => {
    // 0..1 → 0
    expect(starRating10FromOverall(0)).toBe(0)
    expect(starRating10FromOverall(1)).toBe(0)
    // 2..59 → 1
    expect(starRating10FromOverall(2)).toBe(1)
    expect(starRating10FromOverall(40)).toBe(1)
    expect(starRating10FromOverall(59)).toBe(1)
    // 60..62 → 2
    expect(starRating10FromOverall(60)).toBe(2)
    expect(starRating10FromOverall(62)).toBe(2)
    // 63..64 → 3
    expect(starRating10FromOverall(63)).toBe(3)
    expect(starRating10FromOverall(64)).toBe(3)
    // 65..66 → 4
    expect(starRating10FromOverall(65)).toBe(4)
    expect(starRating10FromOverall(66)).toBe(4)
    // 67..68 → 5
    expect(starRating10FromOverall(67)).toBe(5)
    expect(starRating10FromOverall(68)).toBe(5)
    // 69..70 → 6
    expect(starRating10FromOverall(69)).toBe(6)
    expect(starRating10FromOverall(70)).toBe(6)
    // 71..74 → 7
    expect(starRating10FromOverall(71)).toBe(7)
    expect(starRating10FromOverall(74)).toBe(7)
    // 75..78 → 8
    expect(starRating10FromOverall(75)).toBe(8)
    expect(starRating10FromOverall(78)).toBe(8)
    // 79..82 → 9
    expect(starRating10FromOverall(79)).toBe(9)
    expect(starRating10FromOverall(82)).toBe(9)
    // 83..∞ → 10
    expect(starRating10FromOverall(83)).toBe(10)
    expect(starRating10FromOverall(88)).toBe(10)
    expect(starRating10FromOverall(99)).toBe(10)
  })

  it('returns null for missing or non-finite values', () => {
    expect(starRating10FromOverall(null)).toBeNull()
    expect(starRating10FromOverall(undefined)).toBeNull()
    expect(starRating10FromOverall(Number.NaN)).toBeNull()
    expect(starRating10FromOverall(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('overallRangeForStarRating10', () => {
  it('returns the OVR range for each half-star slot', () => {
    expect(overallRangeForStarRating10(0)).toEqual({ min: 0, max: 1 })
    expect(overallRangeForStarRating10(1)).toEqual({ min: 2, max: 59 })
    expect(overallRangeForStarRating10(5)).toEqual({ min: 67, max: 68 })
    expect(overallRangeForStarRating10(9)).toEqual({ min: 79, max: 82 })
    expect(overallRangeForStarRating10(10)).toEqual({
      min: 83,
      max: Number.POSITIVE_INFINITY,
    })
  })

  it('rounds fractional inputs to the nearest half-star slot', () => {
    expect(overallRangeForStarRating10(4.9)).toEqual({ min: 67, max: 68 })
  })

  it('returns null outside the 0-10 range', () => {
    expect(overallRangeForStarRating10(-1)).toBeNull()
    expect(overallRangeForStarRating10(11)).toBeNull()
    expect(overallRangeForStarRating10(Number.NaN)).toBeNull()
  })

  it('round-trips through starRating10FromOverall for every slot', () => {
    for (let rating10 = 0; rating10 <= 10; rating10 += 1) {
      const range = overallRangeForStarRating10(rating10)!
      expect(starRating10FromOverall(range.min)).toBe(rating10)
      if (Number.isFinite(range.max)) {
        expect(starRating10FromOverall(range.max)).toBe(rating10)
      }
    }
  })
})
