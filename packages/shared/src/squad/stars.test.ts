import { describe, expect, it } from 'vitest'
import {
  deriveTeamStarRating10FromOverall,
  resolveEaTeamStarRating10,
} from './stars.js'

describe('team star rating fallback', () => {
  it('maps overall ratings to half-star steps', () => {
    expect(deriveTeamStarRating10FromOverall(84)).toBe(10)
    expect(deriveTeamStarRating10FromOverall(82)).toBe(9)
    expect(deriveTeamStarRating10FromOverall(75)).toBe(8)
    expect(deriveTeamStarRating10FromOverall(71)).toBe(7)
    expect(deriveTeamStarRating10FromOverall(69)).toBe(6)
    expect(deriveTeamStarRating10FromOverall(67)).toBe(5)
    expect(deriveTeamStarRating10FromOverall(65)).toBe(4)
    expect(deriveTeamStarRating10FromOverall(63)).toBe(3)
    expect(deriveTeamStarRating10FromOverall(60)).toBe(2)
    expect(deriveTeamStarRating10FromOverall(40)).toBe(1)
    expect(deriveTeamStarRating10FromOverall(1)).toBe(0)
  })

  it('prefers an exact star value when present', () => {
    expect(resolveEaTeamStarRating10(7, 84)).toBe(7)
    expect(resolveEaTeamStarRating10(null, 84)).toBe(10)
  })
})
