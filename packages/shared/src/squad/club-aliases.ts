/**
 * EA Sports FC 26 ships a handful of clubs under fake names because the real
 * rights holders have exclusivity deals with Konami's eFootball. This module
 * centralises the rename map so the raw EA team name ("Lombardia FC") is
 * normalised to the real-world name ("Inter Milan") before we ever store the
 * `Club` record — downstream consumers see real names everywhere (UI, scoreboard,
 * squad diff, asset-refresh discovery).
 *
 * Seeded from public coverage of FC 26 as of April 2026. Sources:
 *   - https://www.dexerto.com/ea-sports-fc/all-licensed-leagues-teams-stadiums-in-ea-fc-26-3227416/
 *   - https://refifa.com/ea-fc-26-serie-a-license-milan-and-inter-milan-missing/
 *   - https://en.wikipedia.org/wiki/EA_Sports_FC_26
 *
 * **Maintenance notes:**
 * - EA gains/loses licenses year to year. When a new release ships, re-verify
 *   this map against the new unlicensed list (usually the same four Italian
 *   clubs plus whatever moved). A match is safe to remove from the map once
 *   EA has relicensed the club (e.g. Juventus was "Piemonte Calcio" in older
 *   titles but ships under its real name in FC 26, so it does NOT appear
 *   here).
 * - Match is by exact EA name (trimmed + case-insensitive). If EA ever adds
 *   another rename variant (e.g. "Lombardia F.C." vs "Lombardia FC"), add
 *   both keys — we deliberately avoid fuzzy matching here so a real club
 *   whose name happens to contain "Lombardia" never gets silently rewritten.
 */

export interface ClubAlias {
  /** Full canonical real-world name. */
  readonly name: string
  /** Short/abbreviated name used where space is tight (team cards, filters). */
  readonly shortName: string
}

/**
 * Map from EA's in-game fake name to the canonical real-world identity. The
 * lookup key is the EA name *exactly as it appears in the binary* — we
 * preserve the EA spelling rather than normalising, because multiple real
 * teams can end up with the same normalised form.
 */
export const CLUB_NAME_ALIASES: Readonly<Record<string, ClubAlias>> = {
  // Serie A — Konami's eFootball holds exclusive rights for these four, so EA
  // ships them with generic city/regional names.
  'Milano FC': { name: 'AC Milan', shortName: 'MIL' },
  'Lombardia FC': { name: 'Inter Milan', shortName: 'INT' },
  Latium: { name: 'Lazio', shortName: 'LAZ' },
  'Bergamo Calcio': { name: 'Atalanta', shortName: 'ATA' },
}

/**
 * Look up the canonical identity for an EA team name. Returns `null` when
 * the name is not aliased — the caller should keep the raw EA values in that
 * case, since the vast majority of clubs (full Premier League, Bundesliga,
 * LaLiga, Ligue 1, Juventus in Serie A, …) are licensed and ship under their
 * real names.
 *
 * Lookup is trim + case-insensitive to tolerate stray whitespace in the EA
 * binary, but not fuzzy — "Lombardia" alone won't match.
 */
export function canonicaliseClubName(rawName: string): ClubAlias | null {
  const trimmed = rawName.trim()
  if (!trimmed) return null
  const direct = CLUB_NAME_ALIASES[trimmed]
  if (direct) return direct
  // Case-insensitive secondary lookup. We don't lower-case the keys at
  // module scope because the map also doubles as documentation (the keys
  // read like the EA UI); scanning every lookup is cheap (<10 entries).
  const needle = trimmed.toLowerCase()
  for (const key of Object.keys(CLUB_NAME_ALIASES)) {
    if (key.toLowerCase() === needle) {
      return CLUB_NAME_ALIASES[key] ?? null
    }
  }
  return null
}
