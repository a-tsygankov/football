/**
 * FC team star rating helpers.
 *
 * EA doesn't ship a separate star-rating column for clubs — stars are
 * derived from the team's overall rating via a piecewise table:
 *
 * ```
 *    0..1   → 0  stars (0★)
 *    2..59  → 1  half-star (0.5★)
 *   60..62  → 2  half-stars (1★)
 *   63..64  → 3  half-stars (1.5★)
 *   65..66  → 4  half-stars (2★)
 *   67..68  → 5  half-stars (2.5★)
 *   69..70  → 6  half-stars (3★)
 *   71..74  → 7  half-stars (3.5★)
 *   75..78  → 8  half-stars (4★)
 *   79..82  → 9  half-stars (4.5★)
 *   83..∞   → 10 half-stars (5★)
 * ```
 *
 * The half-star integer (0–10) is the canonical scale we store, display,
 * and filter on. `RatingSelector` emits it, `EaTeamCard` / `StarRow` render
 * it, and `Club.starRating` is persisted on this scale from ingest onwards.
 *
 * Use {@link starRating10FromOverall} going OVR → stars, and
 * {@link overallRangeForStarRating10} going stars → OVR range.
 */

export const MIN_STAR_RATING_10 = 0
export const MAX_STAR_RATING_10 = 10

interface StarBand {
  readonly rating10: number
  readonly minOverall: number
  readonly maxOverall: number
}

/**
 * Source-of-truth table for the OVR ↔ half-star mapping. Entries are
 * ordered by increasing rating; both lookup helpers read off this array.
 */
const STAR_BANDS: ReadonlyArray<StarBand> = [
  { rating10: 0, minOverall: 0, maxOverall: 1 },
  { rating10: 1, minOverall: 2, maxOverall: 59 },
  { rating10: 2, minOverall: 60, maxOverall: 62 },
  { rating10: 3, minOverall: 63, maxOverall: 64 },
  { rating10: 4, minOverall: 65, maxOverall: 66 },
  { rating10: 5, minOverall: 67, maxOverall: 68 },
  { rating10: 6, minOverall: 69, maxOverall: 70 },
  { rating10: 7, minOverall: 71, maxOverall: 74 },
  { rating10: 8, minOverall: 75, maxOverall: 78 },
  { rating10: 9, minOverall: 79, maxOverall: 82 },
  { rating10: 10, minOverall: 83, maxOverall: Number.POSITIVE_INFINITY },
]

/**
 * Map an EA overall rating to a half-star count (0–10).
 *
 * Returns `null` for non-finite / missing inputs so callers can distinguish
 * "no data" from a legitimate 0-star result.
 */
export function starRating10FromOverall(overallRating: number | null | undefined): number | null {
  if (typeof overallRating !== 'number' || !Number.isFinite(overallRating)) return null
  for (const band of STAR_BANDS) {
    if (overallRating >= band.minOverall && overallRating <= band.maxOverall) {
      return band.rating10
    }
  }
  // Defensive fallback — bands cover [0, +∞), but guard negative inputs.
  return overallRating < 0 ? 0 : MAX_STAR_RATING_10
}

/**
 * Reverse of {@link starRating10FromOverall}: return the OVR range that
 * maps to the given half-star count, or `null` if the count is outside
 * 0–10.
 *
 * `max` is `Infinity` for the top band (10 half-stars = OVR ≥ 83).
 * Callers filtering on a star slider should use `overall >= min && overall <= max`.
 */
export function overallRangeForStarRating10(
  rating10: number,
): { readonly min: number; readonly max: number } | null {
  if (!Number.isFinite(rating10)) return null
  const rounded = Math.round(rating10)
  const band = STAR_BANDS.find((entry) => entry.rating10 === rounded)
  if (!band) return null
  return { min: band.minOverall, max: band.maxOverall }
}
