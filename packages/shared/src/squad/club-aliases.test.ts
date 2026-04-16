import { describe, expect, it } from 'vitest'
import { CLUB_NAME_ALIASES, canonicaliseClubName } from './club-aliases.js'

describe('canonicaliseClubName', () => {
  it('rewrites the four Serie A fake names to their real identities', () => {
    // These are the confirmed unlicensed clubs in FC 26 — Konami holds the
    // real licences via eFootball. If any of these four *ever* starts
    // shipping under its real name, drop the entry from CLUB_NAME_ALIASES.
    expect(canonicaliseClubName('Lombardia FC')).toEqual({ name: 'Inter Milan', shortName: 'INT' })
    expect(canonicaliseClubName('Milano FC')).toEqual({ name: 'AC Milan', shortName: 'MIL' })
    expect(canonicaliseClubName('Latium')).toEqual({ name: 'Lazio', shortName: 'LAZ' })
    expect(canonicaliseClubName('Bergamo Calcio')).toEqual({ name: 'Atalanta', shortName: 'ATA' })
  })

  it('returns null for licensed clubs so their real EA name passes through unchanged', () => {
    // Juventus ships under its real name in FC 26 (it was "Piemonte Calcio"
    // in older FIFA titles) — explicit regression guard against us copying
    // stale aliases from older cheat sheets.
    expect(canonicaliseClubName('Juventus')).toBeNull()
    expect(canonicaliseClubName('Arsenal')).toBeNull()
    expect(canonicaliseClubName('Bayern München')).toBeNull()
  })

  it('tolerates stray whitespace and case mismatch in the raw EA name', () => {
    // The EA binary is occasionally inconsistent with trailing spaces or
    // capitalisation; fuzzy-match on trim + lowercase only, never on
    // partial substrings so we don't accidentally rewrite a real team.
    expect(canonicaliseClubName('  Lombardia FC  ')?.name).toBe('Inter Milan')
    expect(canonicaliseClubName('lombardia fc')?.name).toBe('Inter Milan')
    expect(canonicaliseClubName('LOMBARDIA FC')?.name).toBe('Inter Milan')
  })

  it('rejects partial / fuzzy matches so innocent clubs are never rewritten', () => {
    // Paranoia guard: if someone ever adds a league called "Lombardia" in
    // a transfer market DLC, a partial match would wreck the data. Only
    // exact names (modulo case + trim) are ever rewritten.
    expect(canonicaliseClubName('Lombardia')).toBeNull()
    expect(canonicaliseClubName('FC Lombardia United')).toBeNull()
    expect(canonicaliseClubName('Milano')).toBeNull()
  })

  it('returns null for empty / whitespace-only input', () => {
    expect(canonicaliseClubName('')).toBeNull()
    expect(canonicaliseClubName('   ')).toBeNull()
  })

  it('exposes CLUB_NAME_ALIASES as an object of the documented shape', () => {
    // Surface-level guard so a refactor that breaks the exported shape
    // gets caught before consumers notice. Checks the map isn't empty and
    // every entry looks right.
    const keys = Object.keys(CLUB_NAME_ALIASES)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      const entry = CLUB_NAME_ALIASES[key]
      expect(entry?.name).toBeTruthy()
      expect(entry?.shortName).toBeTruthy()
      expect(entry?.shortName.length).toBeGreaterThanOrEqual(2)
    }
  })
})
