/**
 * Minimum visible length for a room or gamer name. Counted on the *stem* —
 * after Unicode normalization and stripping punctuation/whitespace — so that
 * decorative spacing or accents can't be used to sneak in a 1-character name.
 *
 * Three keeps the UI readable (initials/avatars look right) and rules out
 * single- and two-letter throwaway entries (`A`, `Bo`) that are frequently
 * test-typos rather than real identities.
 */
export const NAME_STEM_MIN_LENGTH = 3

export function normalizeNameStem(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

export function isValidNameStem(name: string): boolean {
  return normalizeNameStem(name).length >= NAME_STEM_MIN_LENGTH
}
