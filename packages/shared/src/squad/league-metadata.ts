/**
 * Maps EA league IDs to countries and genders, derived from EA CDN leagues.json.
 *
 * Used by the worker to enrich `SquadLeague` records with nationId, gender,
 * and countryName so the web client can filter leagues by country and gender
 * without a second round-trip.
 */

/** LeagueId -> NationId */
export const EA_LEAGUE_NATIONS: ReadonlyMap<number, number> = new Map([
  [1, 13],
  [4, 7],
  [10, 34],
  [13, 14],
  [14, 14],
  [16, 18],
  [17, 18],
  [19, 21],
  [20, 21],
  [31, 27],
  [32, 27],
  [39, 95],
  [41, 36],
  [50, 42],
  [53, 45],
  [54, 45],
  [56, 46],
  [60, 14],
  [61, 14],
  [63, 22],
  [65, 25],
  [66, 37],
  [68, 48],
  [78, 75],
  [80, 4],
  [83, 167],
  [189, 47],
  [308, 38],
  [317, 10],
  [319, 12],
  [322, 17],
  [330, 39],
  [332, 49],
  [350, 183],
  [351, 195],
  [353, 52],
  [1003, 225],
  [1014, 225],
  [2012, 155],
  [2076, 21],
  [2118, 211],
  [2136, 222],
  [2149, 159],
  [2172, 190],
  [2209, 56],
  [2210, 11],
  [2211, 23],
  [2215, 21],
  [2216, 14],
  [2218, 18],
  [2221, 95],
  [2222, 45],
  [2228, 38],
  [2229, 34],
  [2230, 12],
  [2231, 47],
  [2232, 46],
  [2233, 42],
  [2236, 27],
  [2244, 5],
  [2249, 55],
])

/** NationId -> country name (only nations referenced by at least one league). */
export const EA_NATION_NAMES: ReadonlyMap<number, string> = new Map([
  [4, 'Argentina'],
  [5, 'Austria'],
  [7, 'Belgium'],
  [10, 'China PR'],
  [11, 'Colombia'],
  [12, 'Czech Republic'],
  [13, 'Denmark'],
  [14, 'England'],
  [17, 'Finland'],
  [18, 'France'],
  [21, 'Germany'],
  [22, 'Greece'],
  [23, 'Ireland'],
  [25, 'India'],
  [27, 'Italy'],
  [34, 'Netherlands'],
  [36, 'Norway'],
  [37, 'Paraguay'],
  [38, 'Poland'],
  [39, 'Portugal'],
  [42, 'Saudi Arabia'],
  [45, 'Spain'],
  [46, 'Sweden'],
  [47, 'Switzerland'],
  [48, 'Turkey'],
  [49, 'Ukraine'],
  [52, 'Wales'],
  [55, 'Scotland'],
  [56, 'South Korea'],
  [75, 'Japan'],
  [95, 'United States'],
  [155, 'Bolivia'],
  [159, 'Ecuador'],
  [167, 'South Africa'],
  [183, 'Uruguay'],
  [190, 'Chile'],
  [195, 'Peru'],
  [211, 'Venezuela'],
  [222, 'Cyprus'],
  [225, 'Rest of World'],
])

const REST_OF_WORLD_NATION_ID = 225

/** Women's leagues have IDs >= 2209. */
export function isWomensLeague(leagueId: number): boolean {
  return leagueId >= 2209
}

export function getLeagueNationId(leagueId: number): number | null {
  return EA_LEAGUE_NATIONS.get(leagueId) ?? null
}

export function getLeagueCountryName(leagueId: number): string | null {
  const nationId = EA_LEAGUE_NATIONS.get(leagueId)
  if (nationId === undefined) return null
  return EA_NATION_NAMES.get(nationId) ?? null
}

export function isRestOfWorldLeague(leagueId: number): boolean {
  return EA_LEAGUE_NATIONS.get(leagueId) === REST_OF_WORLD_NATION_ID
}

/**
 * Ordered country list for filter pills in the Teams UI. Top leagues
 * (England, Spain, Germany, ...) come first; the long tail follows
 * alphabetically by convention.
 */
export const COUNTRY_PILL_ORDER: ReadonlyArray<{ nationId: number; label: string }> = [
  { nationId: 14, label: 'England' },
  { nationId: 45, label: 'Spain' },
  { nationId: 21, label: 'Germany' },
  { nationId: 27, label: 'Italy' },
  { nationId: 18, label: 'France' },
  { nationId: 34, label: 'Netherlands' },
  { nationId: 95, label: 'United States' },
  { nationId: 75, label: 'Japan' },
  { nationId: 42, label: 'Saudi Arabia' },
  { nationId: 46, label: 'Sweden' },
  { nationId: 39, label: 'Portugal' },
  { nationId: 48, label: 'Turkey' },
  { nationId: 4, label: 'Argentina' },
  { nationId: 36, label: 'Norway' },
  { nationId: 13, label: 'Denmark' },
  { nationId: 7, label: 'Belgium' },
  { nationId: 5, label: 'Austria' },
  { nationId: 55, label: 'Scotland' },
  { nationId: 22, label: 'Greece' },
  { nationId: 12, label: 'Czech Republic' },
  { nationId: 10, label: 'China PR' },
  { nationId: 47, label: 'Switzerland' },
  { nationId: 38, label: 'Poland' },
  { nationId: 56, label: 'South Korea' },
  { nationId: 23, label: 'Ireland' },
  { nationId: 11, label: 'Colombia' },
  { nationId: 49, label: 'Ukraine' },
  { nationId: 25, label: 'India' },
  { nationId: 37, label: 'Paraguay' },
  { nationId: 17, label: 'Finland' },
  { nationId: 52, label: 'Wales' },
  { nationId: 155, label: 'Bolivia' },
  { nationId: 159, label: 'Ecuador' },
  { nationId: 167, label: 'South Africa' },
  { nationId: 183, label: 'Uruguay' },
  { nationId: 190, label: 'Chile' },
  { nationId: 195, label: 'Peru' },
  { nationId: 211, label: 'Venezuela' },
  { nationId: 222, label: 'Cyprus' },
]
